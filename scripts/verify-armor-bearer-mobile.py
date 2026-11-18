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
import json
import re
import sys
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
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared state read failed: ' + response.status);
      const dto = await response.json();
      const world = dto?.world;
      if (!world || !Array.isArray(world.events) ||
          !Array.isArray(world.discoveries) || !Array.isArray(world.creations)) {
        throw new Error('Shared state did not contain the retained world projection.');
      }
      const kernelEvents = Array.isArray(dto.institution?.kernel?.events)
        ? dto.institution.kernel.events : [];
      return {
        revision: world.revision,
        xp: world.xp,
        updatedAt: world.updatedAt,
        eventIds: world.events.map(event => event.id),
        sharedEventIds: world.events
          .filter(event => !['draft', 'repair', 'message-reported'].includes(event.type))
          .map(event => event.id),
        sharedActivityEventIds: world.events
          .filter(event => !['draft', 'repair', 'message-reported', 'discover'].includes(event.type))
          .map(event => event.id),
        events: world.events,
        discoveries: world.discoveries,
        creationVersions: world.creations.map(creation => [creation.id, creation.version]),
        kernelEventIds: kernelEvents.map(event => event.id),
        viewer: {
          id: dto.viewer?.id,
          role: dto.viewer?.role,
          position: dto.viewer?.position
        },
        presence: (Array.isArray(dto.presence) ? dto.presence : []).map(player => ({
          actorId: player.actorId,
          role: player.role,
          name: player.name,
          presenceId: player.id
        }))
      };
    }""")


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


def walk_to(page, place_name):
    if not page.locator("#sheet").is_hidden():
        page.locator("#sheet-close").tap()
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to " + place_name, exact=True)
    expect(route).to_be_visible()
    route.tap()


def enter_institution(page, place_id, place_name):
    walk_to(page, place_name)
    quest.enter_nearby_institution(
        page, place_id, place_name, place_name, timeout=60000
    )


def wait_for_event(page, expected, timeout=60000):
    page.wait_for_function(
        """async expected => {
          const response = await fetch('/api/state', {
            cache: 'no-store', credentials: 'same-origin'
          });
          if (!response.ok) return false;
          const dto = await response.json();
          return (dto.world?.events || []).some(event =>
            event.type === expected.type &&
            event.actor?.id === expected.actorId &&
            event.actor?.role === expected.actorRole &&
            Object.entries(expected.match || {}).every(([key, value]) => event[key] === value)
          );
        }""",
        arg=expected,
        timeout=timeout
    )


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
    context_options = {
        "viewport": {"width": width, "height": 844},
        "is_mobile": True,
        "has_touch": True
    }

    with tempfile.TemporaryDirectory(prefix="ngl-armor-bearer-mobile-") as data_dir:
        process, url = quest.launch_server(data_dir)
        founder_context = browser.new_context(**context_options)
        witness_context = browser.new_context(**context_options)
        founder_page = founder_context.new_page()
        witness_page = witness_context.new_page()
        try:
            attach_observers(founder_page, url, page_errors["founder"], external_requests["founder"])
            attach_observers(witness_page, url, page_errors["witness"], external_requests["witness"])

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
            walk_to(founder_page, "River of Receipts")
            wait_for_event(founder_page, {
                "type": "discover",
                "actorId": founder["id"],
                "actorRole": "founder",
                "match": {"locationId": "river"}
            })
            river_state = read_state(founder_page)
            river_events = [
                event for event in river_state["events"]
                if event.get("type") == "discover" and
                event.get("locationId") == "river" and
                (event.get("actor") or {}).get("id") == founder["id"] and
                (event.get("actor") or {}).get("role") == "founder" and
                event.get("repeat") is not True
            ]
            assert len(river_events) == 1, (
                "One server-accepted first River discovery must be retained for the Founder."
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

            wait_for_event(founder_page, {
                "type": "field-item-forged",
                "actorId": founder["id"],
                "actorRole": "founder",
                "match": {"sourceEventId": discovery_event["id"], "slotId": "scouting"}
            })
            forged_state = read_state(founder_page)
            forge_events = [
                event for event in forged_state["events"]
                if event.get("type") == "field-item-forged" and
                event.get("sourceEventId") == discovery_event["id"] and
                event.get("slotId") == "scouting" and
                (event.get("actor") or {}).get("id") == founder["id"]
            ]
            assert len(forge_events) == 1, "The Forge UI must retain exactly one source-bound item."
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

            wait_for_event(founder_page, {
                "type": "field-item-transfer-offered",
                "actorId": founder["id"],
                "actorRole": "founder",
                "match": {
                    "itemEventId": forge_event["id"],
                    "recipientId": witness["id"],
                    "recipientRole": "witness"
                }
            })
            offered_state = read_state(founder_page)
            offer_events = [
                event for event in offered_state["events"]
                if event.get("type") == "field-item-transfer-offered" and
                event.get("itemEventId") == forge_event["id"] and
                event.get("recipientId") == witness["id"] and
                event.get("recipientRole") == "witness" and
                (event.get("actor") or {}).get("id") == founder["id"]
            ]
            assert len(offer_events) == 1, "The UI must retain one offer to the designated Witness."
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
            accept_button.tap()

            wait_for_event(witness_page, {
                "type": "field-item-transferred",
                "actorId": witness["id"],
                "actorRole": "witness",
                "match": {"offerId": offer_id, "itemEventId": forge_event["id"]}
            })
            transferred_state = read_state(witness_page)
            transfer_events = [
                event for event in transferred_state["events"]
                if event.get("type") == "field-item-transferred" and
                event.get("offerId") == offer_id and
                event.get("itemEventId") == forge_event["id"]
            ]
            assert len(transfer_events) == 1, "Exactly one accepted transfer event must be retained."
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
                    "exactAcceptanceReplayReturnedPriorResult": True,
                    "replayCreatedNoEvent": True
                },
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
