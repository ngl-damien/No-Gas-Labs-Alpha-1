"""Two-session mobile acceptance for the real Forge -> Armor Bearer world loop.

Both actors use separate browser contexts and the touch UI. The Founder walks
to River of Receipts, forges a field item in Forge, and offers it to a live
Witness. The designated Witness accepts in Forge. Negative probes cover an
offline recipient and a sender attempting to accept their own offer. A
same-request replay proves the committed acceptance is idempotent.

Session IDs are pseudonymous. Virtual map movement is not GPS. The source
discovery and transfer are game activity, not external evidence, mastery,
approval, or NGL authority.
"""
import argparse
import importlib.util
import threading
from collections import deque
import json
import re
import sys
import time
from urllib.parse import urljoin
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHARED_ACCEPTANCE = ROOT / "scripts" / "verify-quest-board.py"
SPEC = importlib.util.spec_from_file_location(
    "ngl_shared_quest_board_acceptance",
    SHARED_ACCEPTANCE
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load the shared Quest Board acceptance helpers.")
quest = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = quest
SPEC.loader.exec_module(quest)

FOUNDER_KEY = "fake-browser-fixture-key-not-a-secret"


def read_state(page):
    # Use the browser context's APIRequestContext: canonical server reads bypass
    # page JavaScript and service-worker/cache paths while sharing session cookies.
    response = page.request.get(
        urljoin(page.url, "/api/state"),
        headers={"cache": "no-store"}
    )
    if not response.ok:
        raise RuntimeError("Shared state read failed: " + str(response.status))
    dto = response.json()
    world = dto.get("world")
    if not world or not isinstance(world.get("events"), list) or not isinstance(world.get("discoveries"), list) or not isinstance(world.get("creations"), list):
        raise RuntimeError("Shared state did not contain the retained world projection.")
    kernel_events = dto.get("institution", {}).get("kernel", {}).get("events", [])
    return {
        "revision": world.get("revision"),
        "xp": world.get("xp"),
        "updatedAt": world.get("updatedAt"),
        "eventIds": [event.get("id") for event in world["events"]],
        "sharedEventIds": [
            event.get("id") for event in world["events"]
            if event.get("type") not in ("draft", "repair", "message-reported")
        ],
        "sharedActivityEventIds": [
            event.get("id") for event in world["events"]
            if event.get("type") not in ("draft", "repair", "message-reported", "discover")
        ],
        "events": world["events"],
        "discoveries": world["discoveries"],
        "creationVersions": [[creation.get("id"), creation.get("version")] for creation in world["creations"]],
        "kernelEventIds": [event.get("id") for event in kernel_events],
        "viewer": {
            "id": dto.get("viewer", {}).get("id"),
            "role": dto.get("viewer", {}).get("role"),
            "position": dto.get("viewer", {}).get("position")
        },
        "presence": [
            {"actorId": player.get("actorId"), "role": player.get("role"),
             "name": player.get("name"), "presenceId": player.get("id")}
            for player in dto.get("presence", [])
        ]
    }


def post_action(page, action):
    return page.evaluate("""async action => {
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action)
      });
      return { status: response.status, payload: await response.json() };
    }""", action)


def attach_observers(page, url, page_errors, external_requests):
    origin = url.rstrip("/")

    def record_external_request(request):
        if request.url.startswith(("http://", "https://")) and not request.url.startswith(origin):
            external_requests.append(request.url)

    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("request", record_external_request)


def enter_shared(page, url, expected_role):
    page.goto(url, wait_until="networkidle")
    page.locator("#start-shared").tap()
    page.locator("#world").wait_for(state="visible")
    expect(page.locator("#world")).to_have_attribute("data-world-renderer", "pixel-v1")
    page.wait_for_function(
        """expected => {
          const label = document.querySelector('#mode-label')?.textContent || '';
          const world = document.querySelector('#world');
          return label.includes(expected) && Boolean(world) && !world.hidden;
        }""",
        arg="Founder" if expected_role == "founder" else "Witness",
        timeout=45000
    )
    page.wait_for_function(
        """async expected => {
          const response = await fetch('/api/state', {
            cache: 'no-store', credentials: 'same-origin'
          });
          if (!response.ok) return false;
          const dto = await response.json();
          return dto.viewer?.role === expected &&
            typeof dto.viewer?.id === 'string' && dto.viewer.id.length > 0 &&
            Array.isArray(dto.presence) &&
            dto.presence.some(player =>
              player.actorId === dto.viewer.id && player.role === expected
            );
        }""",
        arg=expected_role,
        timeout=30000
    )
    return read_state(page)["viewer"]


def login_founder(page):
    page.locator("#login-button").tap()
    page.locator("#founder-name").fill("Damien")
    page.locator("#founder-key").fill(FOUNDER_KEY)
    page.locator("#verify-founder").tap()
    page.wait_for_function(
        """() => document.querySelector('#mode-label')?.textContent.includes('Founder')""",
        timeout=30000
    )
    page.wait_for_function(
        """async () => {
          const response = await fetch('/api/state', {
            cache: 'no-store', credentials: 'same-origin'
          });
          if (!response.ok) return false;
          const dto = await response.json();
          return dto.viewer?.id === 'damien' && dto.viewer?.role === 'founder';
        }""",
        timeout=30000
    )
    return read_state(page)["viewer"]


def wait_for_presence(page, actor_id, role, present, timeout=20000):
    page.wait_for_function(
        """async expected => {
          const response = await fetch('/api/state', {
            cache: 'no-store', credentials: 'same-origin'
          });
          if (!response.ok) return false;
          const dto = await response.json();
          const found = (dto.presence || []).some(player =>
            player.actorId === expected.actorId && player.role === expected.role
          );
          return found === expected.present;
        }""",
        arg={"actorId": actor_id, "role": role, "present": present},
        timeout=timeout
    )


def walk_to(page, place_name, place_id):
    # Presence is visible before the position-recovery handshake releases movement.
    page.wait_for_function(
        "() => document.querySelector('#world')?.dataset.movementEnabled === 'true'",
        timeout=45000
    )
    if not page.locator("#sheet").is_hidden():
        page.locator("#sheet-close").tap()
    page.evaluate(
        "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    )
    canvas = page.locator("#world")
    if canvas.get_attribute("data-nearby-institution-id") == place_id:
        return
    before = read_state(page)["viewer"].get("position")
    assert isinstance(before, dict) and all(
        isinstance(before.get(axis), (int, float)) for axis in ("x", "y")
    ), "Shared player position must be observable before world navigation."
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to " + place_name, exact=True)
    expect(route).to_be_visible()
    route.tap()
    try:
        # A first movement frame is not arrival. Wait for the exact destination
        # projection (or institution proximity), not merely a >10-unit change.
        page.wait_for_function(
            """expected => {
              const world = document.querySelector('#world');
              return world?.dataset.nearbyInstitutionId === expected.placeId ||
                (world?.dataset.navigationTargetId === expected.placeId &&
                 world?.dataset.navigationState === 'arrived');
            }""",
            arg={"placeId": place_id},
            timeout=60000
        )
    except Exception as error:
        after = read_state(page)["viewer"].get("position")
        canvas_state = canvas.evaluate("element => ({...element.dataset})")
        raise AssertionError(
            "World route did not reach exact destination " + place_id + ": " +
            json.dumps({"before": before, "after": after, "canvas": canvas_state})
        ) from error


def enter_institution(page, place_id, place_name):
    walk_to(page, place_name, place_id)
    quest.enter_nearby_institution(
        page, place_id, place_name, place_name, timeout=60000
    )


def wait_for_event(page, expected, timeout=60000):
    deadline = time.monotonic() + timeout / 1000
    last_state = None
    while True:
        last_state = read_state(page)
        matched = any(
            event.get("type") == expected.get("type") and
            event.get("actor", {}).get("id") == expected.get("actorId") and
            event.get("actor", {}).get("role") == expected.get("actorRole") and
            all(event.get(key) == value for key, value in expected.get("match", {}).items())
            for event in last_state["events"]
        )
        if matched:
            # Return the exact server snapshot that satisfied the wait. Do not
            # discard it and issue a second, potentially inconsistent read.
            return last_state
        if time.monotonic() >= deadline:
            raise AssertionError(
                "Retained event was not observed in direct server state: " +
                json.dumps({"expected": expected, "lastRevision": last_state.get("revision"),
                            "lastEventTypes": [event.get("type") for event in last_state.get("events", [])]})
            )
        time.sleep(0.2)


def discover_guide(page, place_name, place_id, response_loss_trace=None):
    if response_loss_trace is None:
        walk_to(page, place_name, place_id)
        world = page.locator("#world")
        expect(world).to_have_attribute("data-navigation-target-id", place_id)
        expect(world).to_have_attribute("data-navigation-state", "arrived")
        interact_button = page.locator("#interact-button")
        expect(interact_button).to_be_visible()
        actor = read_state(page)["viewer"]
        interact_button.tap()
        return wait_for_event(page, {
            "type": "discover", "actorId": actor["id"], "actorRole": actor["role"],
            "match": {"locationId": place_id}
        })

    # Install the response-loss route before walking: route completion/proximity
    # can emit the discovery before the explicit Interact control is tapped.
    response_loss_trace.clear()
    actor = read_state(page)["viewer"]
    expected = {
        "type": "discover", "actorId": actor["id"], "actorRole": actor["role"],
        "match": {"locationId": place_id}
    }
    requests = []
    def capture_discovery_request(request):
        if request.method != "POST" or not request.url.rstrip("/").endswith("/api/action"):
            return
        try:
            payload = json.loads(request.post_data or "{}")
        except Exception:
            return
        if payload.get("type") == "discover" and payload.get("locationId") == place_id:
            requests.append({"requestId": payload.get("requestId"), "locationId": place_id})

    def lose_first_discovery_response(route):
        try:
            payload = json.loads(route.request.post_data or "{}")
        except Exception:
            payload = {}
        if payload.get("type") != "discover" or payload.get("locationId") != place_id or response_loss_trace.get("lost"):
            route.continue_()
            return
        upstream = route.fetch()
        body = upstream.json()
        response_loss_trace["lost"] = True
        response_loss_trace["firstResponse"] = {
            "status": upstream.status,
            "requestId": payload.get("requestId"),
            "idempotentReplay": body.get("idempotentReplay"),
            "result": body.get("result"),
            "worldRevision": body.get("world", {}).get("revision")
        }
        route.abort("failed")

    page.on("request", capture_discovery_request)
    page.route("**/api/action", lose_first_discovery_response)
    try:
        walk_to(page, place_name, place_id)
        world = page.locator("#world")
        expect(world).to_have_attribute("data-navigation-target-id", place_id)
        expect(world).to_have_attribute("data-navigation-state", "arrived")
        interact_button = page.locator("#interact-button")
        expect(interact_button).to_be_visible()
        # If route completion/proximity did not emit discovery, explicit Interact
        # starts it. If it already did, do not create a second concurrent tap.
        if not response_loss_trace.get("lost"):
            interact_button.tap()
        first_state = wait_for_event(page, expected, timeout=30000)
        first_events = [event for event in first_state["events"] if
            event.get("type") == "discover" and event.get("locationId") == place_id and
            event.get("actor", {}).get("id") == actor["id"] and
            event.get("actor", {}).get("role") == actor["role"]]
        assert response_loss_trace.get("lost") is True, "The discovery response-loss route did not intercept the action: " + json.dumps(response_loss_trace)
        assert response_loss_trace["firstResponse"]["status"] == 200, "The upstream discovery action was not accepted: " + json.dumps(response_loss_trace)
        assert response_loss_trace["firstResponse"]["idempotentReplay"] is not True, "The first discovery request unexpectedly replayed: " + json.dumps(response_loss_trace)
        assert len(first_events) == 1 and first_events[0].get("repeat") is not True, "The first accepted discovery must retain exactly one non-repeat event: " + json.dumps(response_loss_trace)
        response_loss_trace["retainedAfterFirst"] = {"revision": first_state["revision"], "eventId": first_events[0].get("id"), "requestId": first_events[0].get("requestId"), "count": len(first_events)}
        page.wait_for_function(
            "expected => document.querySelector('#world')?.dataset.worldRevision === String(expected)",
            arg=first_state["revision"], timeout=15000
        )
        page.unroute("**/api/action", lose_first_discovery_response)
        predicate = lambda response: response.request.method == "POST" and response.url.rstrip("/") .endswith("/api/action") and json.loads(response.request.post_data or "{}").get("type") == "discover" and json.loads(response.request.post_data or "{}").get("locationId") == place_id
        with page.expect_response(predicate, timeout=15000) as retry_response:
            interact_button.tap()
        retry = retry_response.value
        retry_body = retry.json()
        response_loss_trace["retryResponse"] = {
            "status": retry.status,
            "requestId": json.loads(retry.request.post_data or "{}").get("requestId"),
            "idempotentReplay": retry_body.get("idempotentReplay"),
            "result": retry_body.get("result"),
            "worldRevision": retry_body.get("world", {}).get("revision")
        }
        after = read_state(page)
        retained = [event for event in after["events"] if
            event.get("type") == "discover" and event.get("locationId") == place_id and
            event.get("actor", {}).get("id") == actor["id"] and
            event.get("actor", {}).get("role") == actor["role"]]
        response_loss_trace["requests"] = requests
        response_loss_trace["retainedAfterRetry"] = {"revision": after["revision"], "eventIds": [event.get("id") for event in retained], "count": len(retained)}
        assert len(requests) == 2 and requests[0].get("requestId") == requests[1].get("requestId") == response_loss_trace["firstResponse"]["requestId"], "The explicit tap must retry the exact pending discovery request ID: " + json.dumps(response_loss_trace)
        assert retry.status == 200 and retry_body.get("idempotentReplay") is True, "The second response must prove idempotent receipt replay: " + json.dumps(response_loss_trace)
        assert len(retained) == 1 and retained[0].get("id") == first_events[0].get("id") and retained[0].get("requestId") == requests[0].get("requestId"), "Retry must not append a duplicate discovery event: " + json.dumps(response_loss_trace)
        assert after["revision"] == first_state["revision"], "Exact discovery replay must not mutate world revision: " + json.dumps(response_loss_trace)
        return after
    except Exception as error:
        response_loss_trace["requestTrace"] = requests
        response_loss_trace["error"] = str(error)[:500]
        raise AssertionError("Retained discovery receipt did not recover after response loss: " + json.dumps(response_loss_trace, sort_keys=True)) from error
    finally:
        try:
            page.unroute("**/api/action", lose_first_discovery_response)
        except Exception:
            pass
        page.remove_listener("request", capture_discovery_request)

def world_signature(snapshot):
    return {
        "revision": snapshot["revision"],
        "xp": snapshot["xp"],
        "updatedAt": snapshot["updatedAt"],
        "eventIds": snapshot["eventIds"],
        "events": snapshot["events"],
        "discoveries": snapshot["discoveries"],
        "creationVersions": snapshot["creationVersions"],
        "kernelEventIds": snapshot["kernelEventIds"]
    }


def assert_world_unchanged(before, after, label):
    assert world_signature(before) == world_signature(after), (
        label + " must not mutate retained world state: " +
        json.dumps({
            "before": world_signature(before),
            "after": world_signature(after)
        })
    )


def assert_rejection(result, expected_code, label):
    error = result["payload"].get("error", {})
    code = error.get("code") if isinstance(error, dict) else result["payload"].get("code")
    assert result["status"] == 409 and code == expected_code, (
        label + " expected HTTP 409 " + expected_code + ", got " +
        json.dumps(result)
    )
    return {"status": result["status"], "code": code}


def inspect_character(page):
    if not page.locator("#sheet").is_hidden():
        page.locator("#sheet-close").tap()
    before = read_state(page)
    page.locator("#character-button").tap()
    page.wait_for_function(
        """() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' &&
          !document.querySelector('#sheet').hidden""",
        timeout=15000
    )

    skills = {}
    for skill_id in ("forger", "armorer", "armor-bearer", "questkeeper"):
        card = page.locator('#sheet-content [data-skill-id="' + skill_id + '"]')
        expect(card).to_have_count(1)
        match = re.search(r"(?m)^(\d+) recorded\b", card.inner_text())
        assert match, "Could not read the " + skill_id + " activity count."
        skills[skill_id] = int(match.group(1))

    header = page.locator("#sheet-content .field-card").first.inner_text()
    xp_match = re.search(r"(\d+) character XP", header)
    assert xp_match, "Character Record did not expose its XP projection."
    after = read_state(page)
    assert_world_unchanged(before, after, "Character Record inspection")
    expect(page.locator('#sheet-content [data-skill-id="armor-bearer"]')).to_contain_text(
        "no XP, mastery or NGL authority"
    )
    expect(page.locator('#sheet-content [data-skill-id="armorer"]')).to_contain_text(
        "not current ownership"
    )
    expect(page.locator('#sheet-content [data-skill-id="armorer"]')).to_contain_text(
        "combat power, mastery, XP or authority"
    )
    return {
        "role": after["viewer"]["role"],
        "actorId": after["viewer"]["id"],
        "characterXp": int(xp_match.group(1)),
        "worldXp": after["xp"],
        "skills": skills,
        "readOnly": True
    }


def assert_objective(page, role, objective_id, progress, event_id=None):
    row = page.locator(
        '#sheet-content [data-objective-id="' + role + "-" + objective_id + '"]'
    )
    expect(row).to_have_count(1)
    expect(row).to_contain_text(progress)
    expect(row.locator(".quest-step-state")).to_have_text(
        "RECORDED" if progress == "1/1" else "OPEN"
    )
    if event_id:
        evidence = row.locator(".quest-evidence")
        expect(evidence).to_have_count(1)
        evidence.locator("summary").tap()
        expect(row).to_contain_text(event_id)


def inspect_quest_board(page, role, expectations):
    if not page.locator("#sheet").is_hidden():
        page.locator("#sheet-close").tap()
    before = read_state(page)
    quest.open_quest_board(page)
    quest.assert_board(page, role)
    for objective_id, progress, event_id in expectations:
        assert_objective(page, role, objective_id, progress, event_id)
    after = read_state(page)
    assert_world_unchanged(before, after, role + " Quest Board inspection")
    return {
        "role": role,
        "objectives": [
            {"id": objective_id, "progress": progress, "evidenceEventId": event_id}
            for objective_id, progress, event_id in expectations
        ],
        "readOnly": True
    }


def assert_no_overflow(page, width, label):
    layout = page.evaluate("""() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      sheetWidth: document.querySelector('#sheet')?.clientWidth ?? null
    })""")
    assert layout["viewportWidth"] == width, label + " viewport changed: " + json.dumps(layout)
    assert layout["documentWidth"] <= layout["viewportWidth"] + 1, (
        label + " introduced horizontal overflow: " + json.dumps(layout)
    )
    return layout


def run_viewport(browser, out, width):
    page_errors = {"founder": [], "witness": []}
    external_requests = {"founder": [], "witness": []}
    diagnostics = {}
    failure = None
    context_options = {
        "viewport": {"width": width, "height": 844},
        "is_mobile": True,
        "has_touch": True
    }

    with tempfile.TemporaryDirectory(prefix="ngl-armor-bearer-mobile-") as data_dir:
        process, url = quest.launch_server(data_dir)
        server_stderr = deque(maxlen=64)
        def drain_server_stderr():
            for line in iter(process.stderr.readline, ''):
                server_stderr.append(line.rstrip()[:500])
        stderr_reader = threading.Thread(target=drain_server_stderr, daemon=True)
        stderr_reader.start()
        founder_context = browser.new_context(**context_options)
        witness_context = browser.new_context(**context_options)
        founder_page = founder_context.new_page()
        witness_page = witness_context.new_page()
        try:
            attach_observers(founder_page, url, page_errors["founder"], external_requests["founder"])
            attach_observers(witness_page, url, page_errors["witness"], external_requests["witness"])
            # Retain bounded request/response evidence for Forge and transfer-offer actions.
            # This distinguishes rejection, replay and accepted responses from projection gaps.
            diagnostics["fieldItemActionTrace"] = {"requests": [], "responses": [], "failures": []}
            def field_item_action_summary(request):
                if request.method != "POST" or not request.url.rstrip("/").endswith("/api/action"):
                    return None
                try:
                    payload = json.loads(request.post_data or "{}")
                except Exception:
                    return None
                if payload.get("type") not in ("forge-field-item", "offer-field-item-transfer", "accept-field-item-transfer"):
                    return None
                return {
                    "type": payload.get("type"),
                    "slotId": payload.get("slotId"),
                    "sourceEventId": payload.get("sourceEventId"),
                    "itemEventId": payload.get("itemEventId"),
                    "offerId": payload.get("offerId"),
                    "recipientId": payload.get("recipientId"),
                    "recipientRole": payload.get("recipientRole"),
                    "requestId": payload.get("requestId")
                }
            def capture_field_item_request(request):
                summary = field_item_action_summary(request)
                if summary is not None and len(diagnostics["fieldItemActionTrace"]["requests"]) < 8:
                    diagnostics["fieldItemActionTrace"]["requests"].append(summary)
            def capture_field_item_response(response):
                summary = field_item_action_summary(response.request)
                if summary is None or len(diagnostics["fieldItemActionTrace"]["responses"]) >= 8:
                    return
                entry = {"status": response.status, "request": summary}
                try:
                    body = response.json()
                    result = body.get("result") if isinstance(body, dict) else None
                    world_snapshot = body.get("world") if isinstance(body, dict) else None
                    entry["idempotentReplay"] = body.get("idempotentReplay") if isinstance(body, dict) else None
                    entry["result"] = {key: result.get(key) for key in ("itemId", "slotId", "sourceEventId", "offerId") if key in result} if isinstance(result, dict) else None
                    entry["worldRevision"] = world_snapshot.get("revision") if isinstance(world_snapshot, dict) else None
                    entry["worldEventTypes"] = [event.get("type") for event in world_snapshot.get("events", []) if isinstance(event, dict)] if isinstance(world_snapshot, dict) and isinstance(world_snapshot.get("events"), list) else None
                    error = body.get("error") if isinstance(body, dict) else None
                    entry["error"] = {key: error.get(key) for key in ("code", "message") if key in error} if isinstance(error, dict) else None
                except Exception as error:
                    entry["jsonError"] = str(error)[:160]
                diagnostics["fieldItemActionTrace"]["responses"].append(entry)
            def capture_field_item_failure(request):
                summary = field_item_action_summary(request)
                if summary is None or len(diagnostics["fieldItemActionTrace"]["failures"]) >= 8:
                    return
                diagnostics["fieldItemActionTrace"]["failures"].append({
                    "request": summary,
                    "failure": str(request.failure)[:240] if request.failure else None
                })
            founder_page.on("request", capture_field_item_request)
            founder_page.on("response", capture_field_item_response)
            founder_page.on("requestfailed", capture_field_item_failure)
            witness_page.on("request", capture_field_item_request)
            witness_page.on("response", capture_field_item_response)
            witness_page.on("requestfailed", capture_field_item_failure)

            witness = enter_shared(witness_page, url, "witness")
            founder_prelogin_witness = enter_shared(founder_page, url, "witness")
            assert witness["role"] == founder_prelogin_witness["role"] == "witness"
            founder = login_founder(founder_page)
            assert founder["role"] == "founder" and founder["id"] != witness["id"]
            assert founder_prelogin_witness["id"] != witness["id"], (
                "Separate browser contexts must receive separate pseudonymous session IDs."
            )

            wait_for_presence(founder_page, witness["id"], "witness", True)
            wait_for_presence(witness_page, founder["id"], "founder", True)
            initial_state = read_state(founder_page)
            initial_kernel_event_ids = initial_state["kernelEventIds"]
            assert initial_state["xp"] == 0, "The disposable world must begin with zero world XP."

            # The Founder must create the source through the walkable world.
            discover_guide(founder_page, "River of Receipts", "river", response_loss_trace=diagnostics.setdefault("discoveryResponseLoss", {}))
            river_state = read_state(founder_page)
            river_events = [
                event for event in river_state["events"]
                if event.get("type") == "discover" and
                event.get("locationId") == "river" and
                (event.get("actor") or {}).get("id") == founder["id"] and
                (event.get("actor") or {}).get("role") == "founder" and
                event.get("repeat") is not True
            ]
            diagnostics["riverDiscovery"] = {
                "founder": founder,
                "viewer": river_state["viewer"],
                "worldRevision": river_state["revision"],
                "position": river_state["viewer"].get("position"),
                "riverEvents": [
                    {
                        "id": event.get("id"),
                        "actor": event.get("actor"),
                        "at": event.get("at"),
                        "repeat": event.get("repeat"),
                        "locationId": event.get("locationId")
                    }
                    for event in river_state["events"]
                    if event.get("type") == "discover" and event.get("locationId") == "river"
                ],
                "riverDiscoveries": [
                    {
                        "id": discovery.get("id"),
                        "actor": discovery.get("actor"),
                        "at": discovery.get("at"),
                        "locationId": discovery.get("locationId")
                    }
                    for discovery in river_state["discoveries"]
                    if discovery.get("locationId") == "river"
                ],
                "worldElement": founder_page.locator("#world").evaluate(
                    "element => ({...element.dataset})"
                )
            }
            assert len(river_events) == 1, (
                "One server-accepted first River discovery must be retained for the Founder: " +
                json.dumps(diagnostics["riverDiscovery"], sort_keys=True)
            )
            discovery_event = river_events[0]

            # Forge UI, not a direct API fixture: choose the exact retained discovery.
            enter_institution(founder_page, "forge", "Forge")
            expect(founder_page.locator("#sheet-title")).to_have_text("Forge")
            forge_root = founder_page.locator("#sheet-content [data-field-forge-root]")
            expect(forge_root).to_have_count(1)
            source_select = founder_page.locator("#sheet-content #forge-source-scouting")
            expect(source_select).to_be_visible()
            source_select.select_option(value=discovery_event["id"])
            founder_page.locator('#sheet-content [data-forge-item="scouting"]').tap()

            forged_state = wait_for_event(founder_page, {
                "type": "field-item-forged",
                "actorId": founder["id"],
                "actorRole": "founder",
                "match": {"sourceEventId": discovery_event["id"], "slotId": "scouting"}
            })
            forge_events = [
                event for event in forged_state["events"]
                if event.get("type") == "field-item-forged" and
                event.get("sourceEventId") == discovery_event["id"] and
                event.get("slotId") == "scouting" and
                (event.get("actor") or {}).get("id") == founder["id"]
            ]
            diagnostics["forge"] = {
                "sourceEventId": discovery_event["id"],
                "actor": {"id": founder["id"], "role": founder["role"]},
                "viewer": forged_state["viewer"],
                "slotId": "scouting",
                "matchingCount": len(forge_events),
                "matchingEvents": [
                    {
                        "id": event.get("id"),
                        "itemId": event.get("itemId"),
                        "sourceEventId": event.get("sourceEventId"),
                        "slotId": event.get("slotId"),
                        "actor": event.get("actor"),
                        "requestId": event.get("requestId")
                    }
                    for event in forge_events
                ],
                "allForgeEvents": [
                    {
                        "id": event.get("id"),
                        "itemId": event.get("itemId"),
                        "sourceEventId": event.get("sourceEventId"),
                        "slotId": event.get("slotId"),
                        "actor": event.get("actor"),
                        "requestId": event.get("requestId")
                    }
                    for event in forged_state["events"]
                    if event.get("type") == "field-item-forged"
                ][:10],
                "worldRevision": forged_state["revision"],
                "worldEventCount": len(forged_state["events"]),
                "worldEventIds": [event.get("id") for event in forged_state["events"]],
                "worldEventTypes": [event.get("type") for event in forged_state["events"]]
            }
            assert len(forge_events) == 1, (
                "The Forge UI must retain exactly one source-bound item: " +
                json.dumps(diagnostics["forge"], sort_keys=True)
            )
            forge_event = forge_events[0]
            item_id = forge_event.get("itemId")
            assert isinstance(item_id, str) and item_id
            founder_item = founder_page.locator(
                '#sheet-content [data-field-item-id="' + item_id + '"]'
            )
            expect(founder_item).to_have_count(1)
            expect(founder_item).to_contain_text("current owner " + founder["id"])
            expect(founder_item).to_contain_text("Original creator " + founder["id"])
            expect(founder_item).to_contain_text("source type guide-discovery")
            expect(founder_item).to_contain_text("retained source event " + discovery_event["id"])
            founder_forge_screenshot = out / ("armor-bearer-founder-forge-" + str(width) + ".png")
            founder_page.screenshot(path=str(founder_forge_screenshot), full_page=True)
            founder_forge_layout = assert_no_overflow(founder_page, width, "Founder Forge")

            # Capture both actors' pre-transfer projections. Reading them is read-only. Reading them is read-only.
            founder_before = inspect_character(founder_page)
            witness_before = inspect_character(witness_page)
            assert founder_before["characterXp"] == witness_before["characterXp"] == 0
            assert founder_before["worldXp"] == witness_before["worldXp"] == 0
            assert founder_before["skills"]["forger"] == 1
            assert witness_before["skills"]["forger"] == 0
            assert founder_before["skills"]["armorer"] == 0
            assert founder_before["skills"]["armor-bearer"] == 0
            assert witness_before["skills"]["armor-bearer"] == 0

            # A live session is required at offer time. Close only the Witness page,
            # observe presence disappear, and prove the failed offer is non-mutating.
            witness_page.goto("about:blank")
            wait_for_presence(founder_page, witness["id"], "witness", False)
            before_offline_offer = read_state(founder_page)
            offline_offer = post_action(founder_page, {
                "type": "offer-field-item-transfer",
                "itemEventId": forge_event["id"],
                "recipientId": witness["id"],
                "recipientRole": "witness",
                "requestId": "armor-bearer-offline-recipient-" + str(width)
            })
            offline_rejection = assert_rejection(
                offline_offer, "TRANSFER_RECIPIENT_OFFLINE", "Offline recipient offer"
            )
            after_offline_offer = read_state(founder_page)
            assert_world_unchanged(before_offline_offer, after_offline_offer, "Rejected offline offer")

            # Reconnect the same Witness session. Presence is still a session fact,
            # not proof of a second human.
            reconnected = enter_shared(witness_page, url, "witness")
            assert reconnected["id"] == witness["id"], "Reconnect must retain the same session actor."
            wait_for_presence(founder_page, witness["id"], "witness", True)
            wait_for_presence(witness_page, founder["id"], "founder", True)

            # Offer through the Founder Field Kit UI to the exact live Witness.
            if not founder_page.locator("#sheet").is_hidden():
                founder_page.locator("#sheet-close").tap()
            enter_institution(founder_page, "forge", "Forge")
            recipient_select = founder_page.locator(
                '#sheet-content [data-transfer-recipient="' + item_id + '"]'
            )
            founder_page.wait_for_function(
                """expected => {
                  const select = document.querySelector(
                    '#sheet-content [data-transfer-recipient="' + expected.itemId + '"]'
                  );
                  return Boolean(select && Array.from(select.options).some(option =>
                    option.value === expected.recipientId &&
                    option.getAttribute('data-role') === 'witness'
                  ));
                }""",
                arg={"itemId": item_id, "recipientId": witness["id"]},
                timeout=20000
            )
            expect(recipient_select).to_be_visible()
            recipient_select.select_option(value=witness["id"])
            founder_page.locator(
                '#sheet-content [data-offer-field-item="' + item_id + '"]'
            ).tap()

            offered_state = wait_for_event(founder_page, {
                "type": "field-item-transfer-offered",
                "actorId": founder["id"],
                "actorRole": "founder",
                "match": {
                    "itemEventId": forge_event["id"],
                    "recipientId": witness["id"],
                    "recipientRole": "witness"
                }
            })
            offer_events = [
                event for event in offered_state["events"]
                if event.get("type") == "field-item-transfer-offered" and
                event.get("itemEventId") == forge_event["id"] and
                event.get("recipientId") == witness["id"] and
                event.get("recipientRole") == "witness" and
                (event.get("actor") or {}).get("id") == founder["id"]
            ]
            diagnostics["offer"] = {
                "itemEventId": forge_event["id"],
                "itemId": item_id,
                "sender": {"id": founder["id"], "role": founder["role"]},
                "viewer": offered_state["viewer"],
                "recipient": {"id": witness["id"], "role": witness["role"]},
                "matchingCount": len(offer_events),
                "matchingEvents": [
                    {
                        "id": event.get("id"), "offerId": event.get("offerId"),
                        "itemEventId": event.get("itemEventId"), "itemId": event.get("itemId"),
                        "recipientId": event.get("recipientId"), "recipientRole": event.get("recipientRole"),
                        "actor": event.get("actor"), "requestId": event.get("requestId"), "at": event.get("at")
                    }
                    for event in offer_events
                ],
                "allOfferEvents": [
                    {"id": event.get("id"), "offerId": event.get("offerId"),
                     "itemEventId": event.get("itemEventId"), "itemId": event.get("itemId"),
                     "recipientId": event.get("recipientId"), "recipientRole": event.get("recipientRole"),
                     "actor": event.get("actor"), "requestId": event.get("requestId")}
                    for event in offered_state["events"] if event.get("type") == "field-item-transfer-offered"
                ][:10],
                "worldRevision": offered_state["revision"],
                "worldEventCount": len(offered_state["events"]),
                "worldEventIds": [event.get("id") for event in offered_state["events"]],
                "worldEventTypes": [event.get("type") for event in offered_state["events"]]
            }
            assert len(offer_events) == 1, (
                "The UI must retain one offer to the designated Witness: " +
                json.dumps(diagnostics["offer"], sort_keys=True)
            )
            offer_event = offer_events[0]
            offer_id = offer_event.get("offerId")
            assert isinstance(offer_id, str) and offer_id
            expect(founder_page.locator(
                '#sheet-content [data-field-item-id="' + item_id + '"] [data-cancel-field-item-transfer]'
            )).to_have_count(1)
            expect(founder_page.locator("#sheet-content [data-accept-field-item-transfer]")).to_have_count(0)
            expect(founder_page.locator(
                '#sheet-content [data-field-item-id="' + item_id + '"]'
            )).to_contain_text("current owner " + founder["id"])
            expect(founder_page.locator(
                '#sheet-content [data-field-item-id="' + item_id + '"]'
            )).to_contain_text("Transfer offer pending to")

            # An offer is not an accepted transfer: neither actor gets Armor Bearer
            # or Questkeeper credit until the designated recipient accepts.
            founder_after_offer = inspect_character(founder_page)
            witness_after_offer = inspect_character(witness_page)
            assert founder_after_offer["skills"]["armor-bearer"] == 0
            assert witness_after_offer["skills"]["armor-bearer"] == 0
            assert founder_after_offer["skills"]["questkeeper"] == founder_before["skills"]["questkeeper"]
            assert witness_after_offer["skills"]["questkeeper"] == witness_before["skills"]["questkeeper"]
            assert founder_after_offer["characterXp"] == witness_after_offer["characterXp"] == 0
            assert founder_after_offer["worldXp"] == witness_after_offer["worldXp"] == 0
            witness_offer_card = witness_page.locator(
                '#sheet-content [data-field-transfer-offer="' + offer_id + '"]'
            )
            expect(witness_offer_card).to_have_count(1)
            expect(witness_offer_card).to_contain_text("Only this recipient session can accept")
            founder_offer_layout = assert_no_overflow(founder_page, width, "Founder pending offer")
            witness_offer_layout = assert_no_overflow(witness_page, width, "Witness incoming offer")

            # The sender cannot accept its own offer, even by bypassing the UI.
            before_wrong_recipient = read_state(founder_page)
            wrong_recipient = post_action(founder_page, {
                "type": "accept-field-item-transfer",
                "offerId": offer_id,
                "requestId": "armor-bearer-wrong-recipient-" + str(width)
            })
            wrong_recipient_rejection = assert_rejection(
                wrong_recipient, "FIELD_ITEM_TRANSFER_NOT_ADDRESSED",
                "Sender attempting to accept its own offer"
            )
            after_wrong_recipient = read_state(founder_page)
            assert_world_unchanged(
                before_wrong_recipient, after_wrong_recipient,
                "Rejected wrong-recipient acceptance"
            )

            # The designated Witness walks to Forge and accepts the visible offer.
            enter_institution(witness_page, "forge", "Forge")
            incoming = witness_page.locator(
                '#sheet-content [data-field-transfer-offer="' + offer_id + '"]'
            )
            expect(incoming).to_have_count(1)
            incoming_screenshot = out / ("armor-bearer-witness-incoming-" + str(width) + ".png")
            witness_page.screenshot(path=str(incoming_screenshot), full_page=True)
            expect(incoming).to_contain_text("Only this recipient session can accept")
            witness_forge_layout = assert_no_overflow(witness_page, width, "Witness Forge incoming offer")
            accept_button = incoming.locator(
                '[data-accept-field-item-transfer="' + offer_id + '"]'
            )
            expect(accept_button).to_have_count(1)
            transfer_response_loss = {
                "lost": False,
                "requests": [],
                "firstResponse": None
            }

            def capture_accept_request(request):
                if request.method != "POST" or not request.url.rstrip("/").endswith("/api/action"):
                    return
                try:
                    payload = json.loads(request.post_data or "{}")
                except Exception:
                    return
                if payload.get("type") == "accept-field-item-transfer" and payload.get("offerId") == offer_id:
                    transfer_response_loss["requests"].append({
                        "requestId": payload.get("requestId"),
                        "offerId": payload.get("offerId")
                    })

            def lose_first_accept_response(route):
                try:
                    payload = json.loads(route.request.post_data or "{}")
                except Exception:
                    payload = {}
                if (payload.get("type") != "accept-field-item-transfer" or
                        payload.get("offerId") != offer_id or transfer_response_loss["lost"]):
                    route.continue_()
                    return
                upstream = route.fetch()
                body = upstream.json()
                transfer_response_loss["lost"] = True
                transfer_response_loss["firstResponse"] = {
                    "status": upstream.status,
                    "requestId": payload.get("requestId"),
                    "idempotentReplay": body.get("idempotentReplay"),
                    "result": body.get("result"),
                    "worldRevision": body.get("world", {}).get("revision")
                }
                route.abort("failed")

            witness_page.route("**/api/action", lose_first_accept_response)
            try:
                accept_button.tap()
                first_state = wait_for_event(founder_page, {
                    "type": "field-item-transferred",
                    "actorId": witness["id"],
                    "actorRole": "witness",
                    "match": {"offerId": offer_id, "itemEventId": forge_event["id"]}
                })
                first_transfer_events = [
                    event for event in first_state["events"]
                    if event.get("type") == "field-item-transferred" and
                    event.get("offerId") == offer_id and
                    event.get("itemEventId") == forge_event["id"] and
                    (event.get("actor") or {}).get("id") == witness["id"] and
                    (event.get("actor") or {}).get("role") == "witness"
                ]
                assert transfer_response_loss["lost"] is True, (
                    "The accepted-transfer response-loss route did not intercept the UI action: " +
                    json.dumps(transfer_response_loss, sort_keys=True)
                )
                first_response = transfer_response_loss["firstResponse"]
                assert first_response["status"] == 200 and first_response["idempotentReplay"] is not True, (
                    "The upstream acceptance must commit once before its browser response is lost: " +
                    json.dumps(transfer_response_loss, sort_keys=True)
                )
                assert len(first_transfer_events) == 1, (
                    "The upstream acceptance must retain exactly one transfer event: " +
                    json.dumps(transfer_response_loss, sort_keys=True)
                )
                first_transfer_event = first_transfer_events[0]
                first_request_id = first_response["requestId"]
                assert isinstance(first_request_id, str) and first_request_id
                assert first_transfer_event.get("requestId") == first_request_id
                assert first_state["revision"] == first_response["worldRevision"]
                transfer_response_loss["retainedAfterFirst"] = {
                    "revision": first_state["revision"],
                    "updatedAt": first_state["updatedAt"],
                    "eventId": first_transfer_event.get("id"),
                    "requestId": first_request_id,
                    "count": len(first_transfer_events)
                }

                # The UI must preserve its exact receipt when the response is lost.
                witness_page.wait_for_function(
                    """() => {
                      const toast = document.querySelector('#toast');
                      return Boolean(toast && !toast.hidden &&
                        toast.textContent.includes('The shared world is unreachable'));
                    }""",
                    timeout=15000
                )
                witness_context.set_offline(True)
                if not witness_page.locator("#sheet").is_hidden():
                    witness_page.locator("#sheet-close").tap()
                witness_page.locator("#journal-button").tap()
                retry_button = witness_page.locator("#retry-pending-shared-action")
                expect(retry_button).to_be_visible()
                journal_text = witness_page.locator("#sheet-content").inner_text()
                assert "ACCEPT-FIELD-ITEM-TRANSFER" in journal_text
                assert first_request_id in journal_text
                assert witness["id"] in journal_text
                transfer_response_loss["journalAvailableWhileOffline"] = True

                witness_page.unroute("**/api/action", lose_first_accept_response)
                witness_context.set_offline(False)

                def is_accept_retry_response(response):
                    if response.request.method != "POST" or not response.url.rstrip("/").endswith("/api/action"):
                        return False
                    try:
                        payload = json.loads(response.request.post_data or "{}")
                    except Exception:
                        return False
                    return payload.get("type") == "accept-field-item-transfer" and payload.get("offerId") == offer_id

                with witness_page.expect_response(is_accept_retry_response, timeout=15000) as retry_response:
                    retry_button.tap()
                retry = retry_response.value
                retry_body = retry.json()
                retry_request_id = json.loads(retry.request.post_data or "{}").get("requestId")
                transfer_response_loss["retryResponse"] = {
                    "status": retry.status,
                    "requestId": retry_request_id,
                    "idempotentReplay": retry_body.get("idempotentReplay"),
                    "result": retry_body.get("result"),
                    "worldRevision": retry_body.get("world", {}).get("revision")
                }
                assert retry.status == 200 and retry_body.get("idempotentReplay") is True, (
                    "The Field Journal retry must recover the original accepted-transfer receipt: " +
                    json.dumps(transfer_response_loss, sort_keys=True)
                )
                assert retry_body.get("result", {}).get("offerId") == offer_id
                assert retry_body.get("result", {}).get("itemId") == forge_event["itemId"]
                assert len(transfer_response_loss["requests"]) == 2
                assert all(item.get("requestId") == first_request_id for item in transfer_response_loss["requests"])
                assert retry_request_id == first_request_id

                transferred_state = read_state(witness_page)
                retained_after_retry = [
                    event for event in transferred_state["events"]
                    if event.get("type") == "field-item-transferred" and
                    event.get("offerId") == offer_id and
                    event.get("itemEventId") == forge_event["id"] and
                    (event.get("actor") or {}).get("id") == witness["id"] and
                    (event.get("actor") or {}).get("role") == "witness"
                ]
                assert len(retained_after_retry) == 1
                assert retained_after_retry[0].get("id") == first_transfer_event.get("id")
                assert retained_after_retry[0].get("requestId") == first_request_id
                assert_world_unchanged(first_state, transferred_state, "Field Journal accepted-transfer recovery")
                assert retry_body.get("world", {}).get("revision") == first_state["revision"]
                assert retry_body.get("world", {}).get("updatedAt") == first_state["updatedAt"]
                transfer_response_loss["retainedAfterRetry"] = {
                    "revision": transferred_state["revision"],
                    "updatedAt": transferred_state["updatedAt"],
                    "eventId": retained_after_retry[0].get("id"),
                    "requestId": retained_after_retry[0].get("requestId"),
                    "count": len(retained_after_retry)
                }
                transfer_response_loss["exactRequestIdReused"] = True
                transfer_response_loss["worldUnchangedOnReplay"] = True
                transfer_response_loss["passed"] = True
                diagnostics["transferResponseLossRecovery"] = transfer_response_loss
            except Exception as error:
                transfer_response_loss["error"] = str(error)[:500]
                diagnostics["transferResponseLossRecovery"] = transfer_response_loss
                raise AssertionError(
                    "Field Journal did not recover the accepted transfer after response loss: " +
                    json.dumps(transfer_response_loss, sort_keys=True)
                ) from error
            finally:
                try:
                    witness_page.unroute("**/api/action", lose_first_accept_response)
                except Exception:
                    pass
                try:
                    witness_context.set_offline(False)
                except Exception:
                    pass
            transfer_events = [
                event for event in transferred_state["events"]
                if event.get("type") == "field-item-transferred" and
                event.get("offerId") == offer_id and
                event.get("itemEventId") == forge_event["id"]
            ]
            diagnostics["transfer"] = {
                "offerId": offer_id,
                "itemEventId": forge_event["id"],
                "itemId": forge_event["itemId"],
                "sender": {"id": founder["id"], "role": founder["role"]},
                "recipient": {"id": witness["id"], "role": witness["role"]},
                "matchingCount": len(transfer_events),
                "matchingEvents": [
                    {
                        "id": event.get("id"),
                        "offerId": event.get("offerId"),
                        "itemEventId": event.get("itemEventId"),
                        "itemId": event.get("itemId"),
                        "actor": event.get("actor"),
                        "fromActorId": event.get("fromActorId"),
                        "fromActorRole": event.get("fromActorRole"),
                        "requestId": event.get("requestId"),
                        "at": event.get("at"),
                        "semantics": event.get("semantics")
                    }
                    for event in transfer_events
                ],
                "allTransferEvents": [
                    {
                        "id": event.get("id"),
                        "offerId": event.get("offerId"),
                        "itemEventId": event.get("itemEventId"),
                        "itemId": event.get("itemId"),
                        "actor": event.get("actor"),
                        "fromActorId": event.get("fromActorId"),
                        "fromActorRole": event.get("fromActorRole"),
                        "requestId": event.get("requestId"),
                        "at": event.get("at")
                    }
                    for event in transferred_state["events"]
                    if event.get("type") == "field-item-transferred"
                ][:10],
                "worldRevision": transferred_state["revision"],
                "worldEventCount": len(transferred_state["events"]),
                "worldEventIds": [event.get("id") for event in transferred_state["events"]],
                "worldEventTypes": [event.get("type") for event in transferred_state["events"]]
            }
            assert len(transfer_events) == 1, (
                "Exactly one accepted transfer event must be retained: " +
                json.dumps(diagnostics["transfer"], sort_keys=True)
            )
            transfer_event = transfer_events[0]
            assert transfer_event.get("actor", {}).get("id") == witness["id"]
            assert transfer_event.get("actor", {}).get("role") == "witness"
            assert transfer_event.get("fromActorId") == founder["id"]
            assert transfer_event.get("fromActorRole") == "founder"
            assert transfer_event.get("itemId") == forge_event["itemId"]
            assert offer_event.get("itemId") == forge_event["itemId"]
            request_id = transfer_event.get("requestId")
            assert "Game projection only" in transfer_event.get("semantics", "")
            assert isinstance(request_id, str) and request_id, (
                "The accepted event must retain its exact idempotency request ID."
            )

            # Same actor + same request ID + same action is a no-op replay.
            before_replay = read_state(witness_page)
            replay = post_action(witness_page, {
                "type": "accept-field-item-transfer",
                "offerId": offer_id,
                "requestId": request_id
            })
            assert replay["status"] == 200 and replay["payload"].get("idempotentReplay") is True, (
                "A committed acceptance retried with its exact request ID must return the prior result."
            )
            assert replay["payload"].get("result", {}).get("offerId") == offer_id
            assert replay["payload"].get("result", {}).get("itemId") == forge_event["itemId"]
            after_replay = read_state(witness_page)
            assert_world_unchanged(before_replay, after_replay, "Exact-request acceptance replay")

            # A request ID cannot be reused for a different action.
            conflict = post_action(witness_page, {
                "type": "cancel-field-item-transfer",
                "offerId": offer_id,
                "requestId": request_id
            })
            conflict_rejection = assert_rejection(
                conflict, "IDEMPOTENCY_CONFLICT", "Conflicting request-ID reuse"
            )
            after_conflict = read_state(witness_page)
            assert_world_unchanged(after_replay, after_conflict, "Rejected conflicting request-ID reuse")

            # Ownership follows the accepted transfer; creator and source do not.
            witness_page.wait_for_function(
                """expected => {
                  const card = document.querySelector(
                    '#sheet-content [data-field-item-id="' + expected.itemId + '"]'
                  );
                  return Boolean(card &&
                    card.textContent.includes('current owner ' + expected.ownerId) &&
                    card.textContent.includes('Original creator ' + expected.creatorId) &&
                    card.textContent.includes('retained source event ' + expected.sourceEventId));
                }""",
                arg={
                    "itemId": item_id,
                    "ownerId": witness["id"],
                    "creatorId": founder["id"],
                    "sourceEventId": discovery_event["id"]
                },
                timeout=20000
            )
            founder_page.wait_for_function(
                """expected => {
                  const root = document.querySelector('#sheet-content [data-field-kit-root]');
                  return Boolean(root &&
                    !root.querySelector('[data-field-item-id="' + expected + '"]') &&
                    root.textContent.includes('No personal field items currently owned'));
                }""",
                arg=item_id,
                timeout=20000
            )
            expect(founder_page.locator(
                '#sheet-content [data-equipment-slot="scouting"]'
            )).to_contain_text("Empty equipment slot")
            expect(witness_page.locator(
                '#sheet-content [data-equipment-slot="scouting"]'
            )).to_contain_text("Empty equipment slot")

            founder_after = inspect_character(founder_page)
            witness_after = inspect_character(witness_page)
            founder_character_layout = assert_no_overflow(founder_page, width, "Founder Character Record")
            witness_character_layout = assert_no_overflow(witness_page, width, "Witness Character Record")
            assert founder_after["characterXp"] == founder_before["characterXp"] == 0
            assert witness_after["characterXp"] == witness_before["characterXp"] == 0
            assert founder_after["worldXp"] == witness_after["worldXp"] == 0
            assert founder_after["skills"]["forger"] == 1
            assert witness_after["skills"]["forger"] == 0
            assert founder_after["skills"]["armorer"] == witness_after["skills"]["armorer"] == 0
            assert founder_after["skills"]["armor-bearer"] == 1
            assert witness_after["skills"]["armor-bearer"] == 0
            assert founder_after["skills"]["questkeeper"] == founder_before["skills"]["questkeeper"] + 1, (
                "Founder Questkeeper must count shared participation but exclude the carry-forward sub-objective."
            )
            assert witness_after["skills"]["questkeeper"] == witness_before["skills"]["questkeeper"] + 1, (
                "Witness Questkeeper must count shared participation but not the sender-only carry-forward objective."
            )

            founder_quest = inspect_quest_board(founder_page, "founder", [
                ("forge-field-item", "1/1", forge_event["id"]),
                ("complete-field-item-transfer", "1/1", transfer_event["id"]),
                ("carry-field-item-forward", "1/1", transfer_event["id"])
            ])
            witness_quest = inspect_quest_board(witness_page, "witness", [
                ("forge-field-item", "0/1", None),
                ("complete-field-item-transfer", "1/1", transfer_event["id"]),
                ("carry-field-item-forward", "0/1", None)
            ])

            final_founder = read_state(founder_page)
            final_witness = read_state(witness_page)
            assert final_founder["revision"] == final_witness["revision"]
            assert final_founder["sharedEventIds"] == final_witness["sharedEventIds"]
            assert final_founder["sharedActivityEventIds"] == final_witness["sharedActivityEventIds"]
            assert final_founder["xp"] == final_witness["xp"] == initial_state["xp"] == 0
            assert final_founder["kernelEventIds"] == final_witness["kernelEventIds"] == initial_kernel_event_ids
            positions = {event["id"]: index for index, event in enumerate(final_founder["events"])}
            ordered_ids = [
                discovery_event["id"], forge_event["id"], offer_event["id"], transfer_event["id"]
            ]
            assert all(event_id in positions for event_id in ordered_ids)
            ordered_positions = [positions[event_id] for event_id in ordered_ids]
            assert len(set(ordered_positions)) == 4 and ordered_positions == sorted(ordered_positions), (
                "Retained world append order must be discovery -> forge -> offer -> accepted transfer."
            )
            event_types = {event.get("type") for event in final_founder["events"]}
            assert event_types == {
                "discover", "field-item-forged", "field-item-transfer-offered", "field-item-transferred"
            }, "The disposable journey must retain only its demonstrated game actions, not publication or authority events."

            assert_no_overflow(founder_page, width, "Founder")
            assert_no_overflow(witness_page, width, "Witness")
            assert not page_errors["founder"], "Founder page errors: " + json.dumps(page_errors["founder"])
            assert not page_errors["witness"], "Witness page errors: " + json.dumps(page_errors["witness"])
            assert external_requests["founder"] == [], (
                "Founder browser made external requests: " + json.dumps(external_requests["founder"])
            )
            assert external_requests["witness"] == [], (
                "Witness browser made external requests: " + json.dumps(external_requests["witness"])
            )

            founder_screenshot = out / ("armor-bearer-founder-quest-" + str(width) + ".png")
            witness_screenshot = out / ("armor-bearer-witness-quest-" + str(width) + ".png")
            founder_page.screenshot(path=str(founder_screenshot), full_page=True)
            witness_page.screenshot(path=str(witness_screenshot), full_page=True)

            return {
                "journey": "forge-to-armor-bearer-" + str(width),
                "passed": True,
                "viewport": width,
                "founder": {
                    "actorId": founder["id"],
                    "role": founder["role"],
                    "before": founder_before,
                    "afterOffer": founder_after_offer,
                    "after": founder_after,
                    "questBoard": founder_quest
                },
                "witness": {
                    "actorId": witness["id"],
                    "role": witness["role"],
                    "before": witness_before,
                    "afterOffer": witness_after_offer,
                    "after": witness_after,
                    "questBoard": witness_quest
                },
                "events": {
                    "initialRevision": initial_state["revision"],
                    "initialKernelEventIds": initial_kernel_event_ids,
                    "initialWorldXp": initial_state["xp"],
                    "finalRevision": final_founder["revision"],
                    "mutuallyVisibleEventIds": final_founder["sharedEventIds"],
                    "appendPositions": {event_id: positions[event_id] for event_id in ordered_ids},
                    "sharedActivityEventIds": final_founder["sharedActivityEventIds"],
                    "discoveryEventId": discovery_event["id"],
                    "forgeEventId": forge_event["id"],
                    "itemId": item_id,
                    "offerEventId": offer_event["id"],
                    "offerId": offer_id,
                    "transferEventId": transfer_event["id"],
                    "acceptRequestId": request_id
                },
                "negativeChecks": {
                    "offlineRecipient": {**offline_rejection, "worldMutation": False},
                    "senderAcceptance": {**wrong_recipient_rejection, "worldMutation": False},
                    "conflictingRequestId": {**conflict_rejection, "worldMutation": False}
                },
                "offerProjection": {
                    "ownerRemainsFounderUntilAcceptance": True,
                    "armorBearerCreditBeforeAcceptance": 0,
                    "questkeeperCreditBeforeAcceptanceUnchanged": True
                },
                "recovery": {
                    "witnessSessionReconnected": reconnected["id"] == witness["id"],
                    "acceptedTransferResponseLostAfterUpstreamCommit": transfer_response_loss["lost"],
                    "fieldJournalAvailableWhileOffline": transfer_response_loss["journalAvailableWhileOffline"],
                    "exactRequestIdRecoveredAfterReconnect": transfer_response_loss["exactRequestIdReused"],
                    "exactAcceptanceReplayReturnedPriorResult": True,
                    "replayCreatedNoEvent": True,
                    "worldUnchangedOnReplay": transfer_response_loss["worldUnchangedOnReplay"]
                },
                "transferResponseLossRecovery": transfer_response_loss,
                "provenance": {
                    "creatorRemainsFounder": True,
                    "sourceRemainsRiverDiscovery": True,
                    "currentOwnerIsWitness": True
                },
                "authorityBoundary": {
                    "worldXp": 0,
                    "characterXp": {"founder": founder_after["characterXp"], "witness": witness_after["characterXp"]},
                    "armorBearerIsSenderOnly": True,
                    "armorerRemainsZero": True,
                    "noNewInstitutionalKernelEvents": True,
                    "noAuthorityOrDecisionEvents": True
                },
                "readOnlyProjections": {
                    "characterSheets": True,
                    "questBoards": True
                },
                "noPageErrors": True,
                "noExternalRequests": True,
                "noHorizontalOverflow": True,
                "mobileLayouts": {
                    "founderForge": founder_forge_layout,
                    "founderPendingOffer": founder_offer_layout,
                    "witnessIncomingOffer": witness_offer_layout,
                    "witnessForgeIncomingOffer": witness_forge_layout,
                    "founderCharacterRecord": founder_character_layout,
                    "witnessCharacterRecord": witness_character_layout
                },
                "screenshots": [
                    founder_forge_screenshot.name,
                    incoming_screenshot.name,
                    founder_screenshot.name,
                    witness_screenshot.name
                ]
            }
        except Exception as error:
            failure = {
                "journey": "forge-to-armor-bearer-" + str(width),
                "passed": False,
                "viewport": width,
                "error": repr(error),
                "diagnostics": diagnostics,
                "pageErrors": page_errors,
                "externalRequests": external_requests
            }
            (out / ("failure-" + str(width) + ".json")).write_text(
                json.dumps(failure, indent=2), encoding="utf-8"
            )
            try:
                founder_page.screenshot(
                    path=str(out / ("failure-founder-" + str(width) + ".png")),
                    full_page=True
                )
                witness_page.screenshot(
                    path=str(out / ("failure-witness-" + str(width) + ".png")),
                    full_page=True
                )
            except Exception:
                pass
            raise
        finally:
            founder_context.close()
            witness_context.close()
            quest.stop_server(process)
            stderr_reader.join(timeout=2)
            diagnostics["serverStderr"] = list(server_stderr)
            diagnostics["serverExitCode"] = process.returncode
            if failure is not None:
                failure["diagnostics"] = diagnostics
                failure["serverExitCode"] = process.returncode
                (out / ("failure-" + str(width) + ".json")).write_text(
                    json.dumps(failure, indent=2), encoding="utf-8"
                )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="/tmp/ngl-armor-bearer-mobile")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--no-sandbox"])
        try:
            for width in (320, 390):
                result = run_viewport(browser, out, width)
                results.append(result)
                (out / "results.json").write_text(
                    json.dumps(results, indent=2), encoding="utf-8"
                )
                print(json.dumps(result), flush=True)
        finally:
            browser.close()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
