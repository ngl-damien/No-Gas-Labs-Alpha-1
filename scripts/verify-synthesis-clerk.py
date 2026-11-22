"""Touch-browser acceptance for the in-world Synthesis Clerk.

A disposable shared world records a Founder proposal and failed attempt, a
separate Witness records a methodological challenge, and the Founder visits
the Synthesis Clerk NPC through the world route and Interact control. A
packet-bound response is validated and explicitly archived as untrusted
history. The test then simulates a post-commit response failure, reloads the client,
re-enters the shared world, and verifies that automatic Relay recovery replays
the exact actor-bound action without duplicating the canonical response. Walking to guide locations may
append actor-scoped discoveries; the journey separates those route events from
read-only NPC, Quest Board, and character inspection.
"""
import argparse
import hashlib
import json
import math
import select
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FOUNDER_KEY = "fake-browser-fixture-key-not-a-secret"
SERVER = """import {createGameServer} from './game/server.mjs';
const githubSourceFetch=async()=>new Response(JSON.stringify({message:'fixture upstream unavailable'}),{
  status:503,
  headers:{'content-type':'application/json'}
});
const server=await createGameServer({
  dataDir:process.argv[1],
  founderKey:'fake-browser-fixture-key-not-a-secret',
  githubSourceFetch
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.once('SIGTERM',()=>server.closeGame());"""


def launch_server(data_dir):
    process = subprocess.Popen(
        ["node", "--input-type=module", "-e", SERVER, str(data_dir)],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    if not select.select([process.stdout], [], [], 15)[0]:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        raise AssertionError("Disposable game server did not become ready within 15 seconds.")
    line = process.stdout.readline()
    if not line:
        detail = process.stderr.read()
        process.wait(timeout=10)
        raise AssertionError("Disposable game server exited before readiness: " + detail)
    ready = json.loads(line)
    return process, "http://127.0.0.1:" + str(ready["port"]) + "/"


def stop_server(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise AssertionError("Disposable game server did not shut down cleanly.")
    if process.returncode != 0:
        detail = process.stderr.read()
        raise AssertionError(
            "Disposable game server exited " + str(process.returncode) + ": " + detail
        )


def wait_for_shared_connection(page, stage):
    try:
        page.wait_for_function(
            "() => document.querySelector('#connection-dot')?.dataset.connectionState === 'online' && " +
            "!document.querySelector('#mode-label')?.textContent.includes('reconnecting')",
            timeout=30000
        )
    except Exception as error:
        state = page.locator("#connection-dot").get_attribute("data-connection-state") or "unknown"
        label = page.locator("#mode-label").text_content() or ""
        raise AssertionError(
            "Shared event stream did not reconnect before " + stage +
            " (connection state=" + state + ", mode label=" + label + ")."
        ) from error


def start_shared(page):
    page.locator("#start-shared").tap()
    page.locator("#world").wait_for(state="visible")
    expect(page.locator("#world")).to_have_attribute("data-world-renderer", "pixel-v1")
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
    )
    wait_for_shared_connection(page, "starting the shared world")


def enter_nearby_institution(page, place_id, accessible_name, title, timeout=30000):
    page.bring_to_front()
    page.wait_for_function(
        """expected => {
            const world = document.querySelector('#world');
            const sheet = document.querySelector('#sheet');
            const enterButton = document.querySelector('#enter-institution-button');
            const primaryButton = document.querySelector('#interact-button');
            const separateEntry = enterButton && !enterButton.hidden &&
                enterButton.getAttribute('aria-label') === expected.ariaLabel;
            return world?.dataset.nearbyInstitutionId === expected.placeId &&
                sheet?.hidden === true &&
                (separateEntry || primaryButton?.getAttribute('aria-label') === expected.ariaLabel);
        }""",
        arg={'placeId': place_id, 'ariaLabel': 'Enter ' + accessible_name},
        timeout=timeout
    )
    enter_button = page.locator('#enter-institution-button')
    if enter_button.is_visible():
        enter_button.tap()
    else:
        page.locator('#interact-button').tap()
    page.wait_for_function(
        "(expected) => document.querySelector('#sheet-title')?.textContent === expected && " +
        "!document.querySelector('#sheet').hidden",
        arg=title,
        timeout=timeout
    )


def login_founder(page):
    page.locator("#login-button").tap()
    page.locator("#founder-name").fill("Damien")
    page.locator("#founder-key").fill(FOUNDER_KEY)
    page.locator("#verify-founder").tap()
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
    )
    state = authoritative_snapshot(page)
    wait_for_shared_connection(page, "Founder session readiness")
    assert state["viewer"]["role"] == "founder"
    return state["viewer"]


def authoritative_snapshot(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared state read failed: ' + response.status);
      const dto = await response.json();
      const world = dto && dto.world;
      if (!world || !Array.isArray(world.events) || !Array.isArray(world.creations)) {
        throw new Error('Shared state did not contain a bounded world projection.');
      }
      return {
        revision: world.revision,
        xp: world.xp,
        eventIds: world.events.map(event => event.id),
        events: world.events.map(event => ({
          id: event.id,
          type: event.type,
          actorId: event.actor?.id,
          actorRole: event.actor?.role,
          locationId: event.locationId,
          repeat: event.repeat,
          moonshotId: event.moonshotId,
          reportId: event.reportId,
          challengeId: event.challengeId,
          responseId: event.responseId,
          role: event.role,
          validationStatus: event.validationStatus,
          validator: event.validator,
          sourceEventIds: event.sourceEventIds,
          responseText: event.responseText
        })),
        retainedEvents: world.events,
        draftCount: Array.isArray(world.drafts) ? world.drafts.length : -1,
        creationIds: world.creations.map(creation => creation.id),
        creationRecords: world.creations.map(creation => ({
          id: creation.id,
          version: creation.version,
          receipt: creation.receipt,
          versions: (Array.isArray(creation.versions) ? creation.versions : []).map(version => ({
            version: version.version,
            receipt: version.receipt
          }))
        })),
        viewer: { id: dto.viewer?.id, role: dto.viewer?.role }
      };
    }""")


def authoritative_position(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared position read failed: ' + response.status);
      const dto = await response.json();
      const position = dto?.viewer?.position;
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        throw new Error('Shared state did not expose a finite accepted session position.');
      }
      return { x: position.x, y: position.y };
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
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          'Fixture action ' + action.type + ' failed (' + response.status + '): ' +
          JSON.stringify(payload)
        );
      }
      return payload;
    }""", action)


def project_synthesis_packet(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Packet source read failed: ' + response.status);
      const dto = await response.json();
      const { projectCollaboratorPackets } = await import('/collaborator-contracts.mjs');
      const packet = projectCollaboratorPackets(dto.world)
        .find(candidate => candidate.id === 'synthesizer');
      if (!packet) throw new Error('Synthesis Clerk projection was not returned.');
      return {
        available: packet.available,
        reason: packet.reason,
        moonshotId: packet.moonshotId,
        inputRefs: [...packet.inputRefs],
        omittedCount: packet.omittedCount,
        sourceSnapshot: packet.sourceSnapshot,
        packetJson: packet.packetJson,
        prompt: packet.prompt
      };
    }""")


def find_event(state, event_type, **fields):
    for event in state["events"]:
        if event["type"] != event_type:
            continue
        if all(event.get(key) == value for key, value in fields.items()):
            return event
    return None


def find_retained_event(state, event_type, **fields):
    for event in state["retainedEvents"]:
        if event.get("type") != event_type:
            continue
        if all(event.get(key) == value for key, value in fields.items()):
            return event
    return None


def assert_canonical_state_unchanged(before, after, label):
    assert after["revision"] == before["revision"], label + " changed the canonical revision."
    assert after["eventIds"] == before["eventIds"], label + " appended or removed world events."
    assert after["retainedEvents"] == before["retainedEvents"], label + " changed retained event contents."
    assert after["xp"] == before["xp"], label + " changed world XP."
    assert after["creationIds"] == before["creationIds"], label + " created or removed publications."
    assert after["creationRecords"] == before["creationRecords"], label + " changed a retained publication version or receipt."


def wait_for_stable_world_snapshot(page, attempts=12):
    previous = authoritative_snapshot(page)
    for _ in range(attempts):
        page.wait_for_timeout(100)
        current = authoritative_snapshot(page)
        if current["revision"] == previous["revision"] and current["eventIds"] == previous["eventIds"]:
            return current
        previous = current
    raise AssertionError("The shared world did not settle after in-world travel.")


def assert_route_travel_records_only_discoveries(before, after, label):
    assert after["xp"] == before["xp"], label + " changed world XP."
    assert after["creationRecords"] == before["creationRecords"], label + " changed a retained publication."
    assert after["eventIds"][:len(before["eventIds"])] == before["eventIds"], label + " rewrote or removed earlier event IDs."
    before_events = before["retainedEvents"]
    after_events = after["retainedEvents"]
    assert after_events[:len(before_events)] == before_events, label + " changed earlier retained event contents."
    added = after_events[len(before_events):]
    assert after["eventIds"][len(before["eventIds"]):] == [event["id"] for event in added], label + " event IDs do not match the appended event records."
    assert after["revision"] == before["revision"] + len(added), label + " revision delta does not match appended event count."
    for event in added:
        assert event.get("type") == "discover", label + " appended a non-discovery event: " + str(event.get("type"))
        assert event.get("actor", {}).get("id") == before["viewer"]["id"], label + " attributed a route discovery to another actor."
        assert event.get("actor", {}).get("role") == before["viewer"]["role"], label + " attributed a route discovery to another role."
        assert event.get("locationId") in {"relay", "river", "overlook", "ruins", "source_observatory"}, label + " recorded an unknown guide or institution location."
        assert event.get("repeat") in (None, True), label + " recorded an invalid repeat-discovery marker."
    return [
        {"eventId": event["id"], "locationId": event["locationId"], "repeat": event.get("repeat") is True}
        for event in added
    ]


def logout_to_witness(page):
    viewer = page.evaluate("""async () => {
      const response = await fetch('/api/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error('Founder-to-Witness rotation failed: ' + response.status);
      return (await response.json()).viewer;
    }""")
    assert viewer["role"] == "witness"
    page.reload(wait_until="networkidle")
    start_shared(page)
    state = authoritative_snapshot(page)
    assert state["viewer"]["id"] == viewer["id"]
    assert state["viewer"]["role"] == "witness"
    return state["viewer"]


def seed_source_observatory(page, width):
    before = authoritative_snapshot(page)
    assert before["viewer"]["role"] == "founder"
    if page.locator("#sheet").is_visible():
        page.locator("#sheet-close").tap()
    page.bring_to_front()
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to Source Observatory", exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, "source_observatory", "Source Observatory", "Source Observatory")
    after_arrival = authoritative_snapshot(page)
    route_discoveries = assert_route_travel_records_only_discoveries(
        before, after_arrival, "Walking to Source Observatory for the research notebook fixture"
    )
    create_button = page.locator('[data-source-observatory-create="true"]')
    expect(create_button).to_be_visible()
    create_button.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Give an idea a place.'",
        timeout=30000
    )
    expect(page.locator("#recipe-select")).to_have_value("observatory")
    title = "Synthesis Clerk research notebook " + str(width)
    page.locator("#command-input").fill(title)
    page.locator("#intent-input").fill(
        "Retain source-bound leads carried from the build-time Synthesis Clerk project-state snapshot."
    )
    page.locator("#draft-button").tap()
    expect(page.locator("#publish-button")).to_be_visible()
    page.locator("#publish-button").tap()
    page.wait_for_function(
        "(expected) => document.querySelector('#sheet-title')?.textContent === expected",
        arg=title,
        timeout=30000
    )
    after = authoritative_snapshot(page)
    assert after["xp"] == before["xp"] + 100, (
        "The explicit Source Observatory publication should earn its existing 100 WORLD XP."
    )
    assert len(after["creationIds"]) == 1, "The disposable fixture should contain exactly one published Observatory."
    creation_id = after["creationIds"][0]
    publication = find_retained_event(after, "publish", creationId=creation_id, version=1)
    assert publication is not None, "The Observatory must be backed by one retained publication event."
    assert publication["actor"]["id"] == before["viewer"]["id"]
    assert publication["actor"]["role"] == "founder"
    creation = page.evaluate("""async id => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Published Observatory read failed: ' + response.status);
      const dto = await response.json();
      return dto.world.creations.find(item => item.id === id) || null;
    }""", creation_id)
    assert creation and creation["kind"] == "observatory" and creation["version"] == 1
    page.locator("#sheet-close").tap()
    return {
        "creationId": creation_id,
        "title": title,
        "version": 1,
        "publishEventId": publication["id"],
        "publicationXp": after["xp"] - before["xp"],
        "routeDiscoveryEventIds": [item["eventId"] for item in route_discoveries]
    }




def seed_source_archive_failure(page, width):
    before = authoritative_snapshot(page)
    assert before["viewer"]["role"] == "founder"
    commit_sha = "f" * 40
    path = "test/fixtures/failure-ledger.mjs"
    actions = []
    for index in range(13):
        request_id = "source-archive-failure-ledger-" + str(width) + "-" + str(index + 1).zfill(2)
        actions.append({
            "type": "draft-github-source-archive",
            "requestId": request_id,
            "permalink": "https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/" + commit_sha + "/" + path,
            "gitBlobSha": "a" * 40,
            "sha256": "b" * 64,
            "size": 1
        })
    results = page.evaluate("""async actions => {
      const results = [];
      for (const action of actions) {
        const response = await fetch('/api/action', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(action)
        });
        results.push({ status: response.status, payload: await response.json() });
      }
      return results;
    }""", actions)
    assert len(results) == 13
    for result in results:
        assert result["status"] == 502, json.dumps(result)
        assert result["payload"]["error"]["code"] == "GITHUB_SOURCE_UNAVAILABLE"
        assert "retained in Chronicle" in result["payload"]["error"]["message"]

    after = authoritative_snapshot(page)
    assert after["revision"] == before["revision"] + 13
    assert after["xp"] == before["xp"], "failed source captures must award no XP"
    assert after["draftCount"] == before["draftCount"], "failed source captures must not create drafts"
    assert after["creationRecords"] == before["creationRecords"]
    assert after["creationIds"] == before["creationIds"]
    added = after["retainedEvents"][len(before["retainedEvents"]):]
    assert len(added) == 13, "the server must append one failure event per distinct request"
    failures = []
    for index, failure in enumerate(added):
        request_id = actions[index]["requestId"]
        assert failure["type"] == "source-archive-attempt-failed"
        assert failure["actor"]["id"] == before["viewer"]["id"]
        assert failure["actor"]["role"] == "founder"
        assert failure["failureCode"] == "GITHUB_SOURCE_UNAVAILABLE"
        assert failure["retryable"] is True
        assert failure["observedBy"] == "shared-source-archive-service"
        assert failure["repository"] == "ngl-damien/No-Gas-Labs-Alpha-1"
        assert failure["commitSha"] == commit_sha
        assert failure["path"] == path
        assert failure["requestIdDigest"] == hashlib.sha256(request_id.encode("utf-8")).hexdigest()
        assert len(failure["actionDigest"]) == 64
        assert failure["attemptId"].startswith("source-archive-attempt-")
        assert "requestId" not in failure and "actionFingerprint" not in failure and "actionResult" not in failure
        failures.append(failure)
    assert len({failure["id"] for failure in failures}) == 13
    assert len({failure["attemptId"] for failure in failures}) == 13
    assert len({failure["requestIdDigest"] for failure in failures}) == 13
    return {
        "eventId": failures[-1]["id"],
        "oldestEventId": failures[0]["id"],
        "eventIds": [failure["id"] for failure in failures],
        "count": len(failures),
        "worldRevision": after["revision"],
        "attemptId": failures[-1]["attemptId"],
        "failureCode": failures[-1]["failureCode"],
        "retryable": failures[-1]["retryable"],
        "requestIdDigest": failures[-1]["requestIdDigest"],
        "commitSha": commit_sha,
        "path": path,
        "xpDelta": after["xp"] - before["xp"],
        "draftDelta": after["draftCount"] - before["draftCount"]
    }

def inspect_source_archive_failure_ledger(page, failure, width, out):
    if page.locator("#sheet").is_visible():
        page.locator("#sheet-close").tap()
    page.bring_to_front()
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to Evidence Archive", exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, "evidence_archive", "Evidence Archive", "Evidence Archive")
    # Arrival may legitimately append a location-discovery event. Bind the
    # page-revision assertion to the post-arrival snapshot, not the pre-route seed.
    archive_snapshot = authoritative_snapshot(page)
    failure["worldRevision"] = archive_snapshot["revision"]

    section = page.locator('#sheet-content [data-source-archive-failure-ledger="true"]')
    cards = section.locator('[data-source-archive-failure-card="true"]')
    expect(cards).to_have_count(12)
    expect(section).to_have_attribute("data-source-archive-failure-page", "0")
    expect(section).to_have_attribute("data-source-archive-failure-page-revision", str(failure["worldRevision"]))
    expect(section).to_have_attribute("data-source-archive-failure-page-size", "12")
    expect(section).to_have_attribute("data-source-archive-failure-total", "13")
    expect(section).to_have_attribute("data-source-archive-failure-total-pages", "2")
    expect(section).to_have_attribute("data-source-archive-failure-has-older", "true")
    expect(section).to_have_attribute("data-source-archive-failure-has-newer", "false")
    expect(cards.nth(0)).to_have_attribute("data-source-archive-failure-event-id", failure["eventId"])
    expect(cards.nth(11)).to_have_attribute("data-source-archive-failure-event-id", failure["eventIds"][1])
    card = cards.nth(0)
    expect(card).to_have_attribute("data-source-archive-failure-status", "retryable")
    expect(card).to_contain_text("GitHub source unavailable")
    expect(card).to_contain_text("RETRYABLE · UPSTREAM UNAVAILABLE")
    expect(card).to_contain_text("GITHUB_SOURCE_UNAVAILABLE")
    expect(card).to_contain_text("ngl-damien/No-Gas-Labs-Alpha-1")
    expect(card).to_contain_text("failure-ledger.mjs")
    expect(card).to_contain_text(failure["eventId"])
    expect(card).to_contain_text("Service-observed retrieval/build failure only")
    expect(section).to_contain_text("Showing failure records 2–13 of 13")
    archive_layout = assert_mobile_layout(page, width)

    before_navigation = authoritative_snapshot(page)
    older = section.locator('[data-source-archive-failure-older="true"]')
    expect(older).to_have_count(1)
    older.tap()
    expect(cards).to_have_count(1)
    expect(section).to_have_attribute("data-source-archive-failure-page", "1")
    expect(section).to_have_attribute("data-source-archive-failure-page-revision", str(failure["worldRevision"]))
    expect(section).to_have_attribute("data-source-archive-failure-has-older", "false")
    expect(section).to_have_attribute("data-source-archive-failure-has-newer", "true")
    expect(cards.nth(0)).to_have_attribute("data-source-archive-failure-event-id", failure["oldestEventId"])
    expect(section).to_contain_text("Showing failure records 1–1 of 13")

    after_older = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        before_navigation, after_older,
        "Paging to older Source Archive failures"
    )

    # Evidence Archive is a coherent accepted snapshot. A newer event must not
    # silently replace the older page while the player is still inspecting it.
    previous_archive_revision = section.get_attribute("data-source-archive-failure-page-revision")
    previous_archive_page = section.get_attribute("data-source-archive-failure-page")
    previous_archive_total = section.get_attribute("data-source-archive-failure-total")
    assert previous_archive_revision == str(after_older["revision"])
    assert previous_archive_page == "1"
    assert previous_archive_total == "13"

    revision_request_id = "source-archive-failure-ledger-revision-" + str(width)
    revision_action = {
        "type": "draft-github-source-archive",
        "requestId": revision_request_id,
        "permalink": "https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/" + failure["commitSha"] + "/" + failure["path"],
        "gitBlobSha": "a" * 40,
        "sha256": "b" * 64,
        "size": 1
    }
    revision_result = page.evaluate("""async action => {
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action)
      });
      return { status: response.status, payload: await response.json() };
    }""", revision_action)
    assert revision_result["status"] == 502, json.dumps(revision_result)
    assert revision_result["payload"]["error"]["code"] == "GITHUB_SOURCE_UNAVAILABLE"
    after_new_failure = authoritative_snapshot(page)
    assert after_new_failure["revision"] == after_older["revision"] + 1
    assert after_new_failure["xp"] == after_older["xp"]
    assert after_new_failure["draftCount"] == after_older["draftCount"]
    new_events = after_new_failure["retainedEvents"][len(after_older["retainedEvents"]):]
    assert len(new_events) == 1
    new_failure = new_events[0]
    assert new_failure["type"] == "source-archive-attempt-failed"
    assert new_failure["requestIdDigest"] == hashlib.sha256(revision_request_id.encode("utf-8")).hexdigest()
    assert new_failure["actor"]["id"] == after_older["viewer"]["id"]
    assert new_failure["actor"]["role"] == "founder"
    failure["eventIds"].append(new_failure["id"])
    failure["eventId"] = new_failure["id"]
    failure["count"] += 1
    failure["worldRevision"] = after_new_failure["revision"]
    failure["attemptId"] = new_failure["attemptId"]
    failure["requestIdDigest"] = new_failure["requestIdDigest"]

    page.wait_for_function(
        "() => document.getElementById('world')?.dataset.worldRevision === '" + str(after_new_failure["revision"]) + "'",
        timeout=30000
    )
    refresh_notice = page.locator(
        '#sheet-content [data-evidence-archive-snapshot-freshness="refresh-required"]'
    )
    expect(refresh_notice).to_have_count(1)
    expect(refresh_notice).to_have_attribute("data-snapshot-revision", previous_archive_revision)
    expect(refresh_notice).to_have_attribute("data-current-revision", str(after_new_failure["revision"]))
    expect(section).to_have_attribute("data-source-archive-failure-page", previous_archive_page)
    expect(section).to_have_attribute("data-source-archive-failure-page-revision", previous_archive_revision)
    expect(section).to_have_attribute("data-source-archive-failure-total", previous_archive_total)
    expect(section).to_have_attribute("data-source-archive-failure-has-older", "false")
    expect(section).to_have_attribute("data-source-archive-failure-has-newer", "true")
    expect(cards).to_have_count(1)
    expect(cards.nth(0)).to_have_attribute(
        "data-source-archive-failure-event-id", failure["oldestEventId"]
    )
    expect(section).to_contain_text("Showing failure records 1–1 of 13")

    refresh_button = refresh_notice.locator('[data-evidence-archive-refresh="true"]')
    expect(refresh_button).to_have_count(1)
    refresh_button.tap()
    page.wait_for_function(
        "expected => document.querySelector('#sheet-title')?.textContent === 'Evidence Archive' && " +
        "document.querySelector('#sheet-content [data-source-archive-failure-ledger]')?.getAttribute('data-source-archive-failure-page-revision') === String(expected)",
        arg=after_new_failure["revision"],
        timeout=30000
    )
    expect(page.locator(
        '#sheet-content [data-evidence-archive-snapshot-freshness]'
    )).to_have_count(0)
    expect(section).to_have_attribute("data-source-archive-failure-page", "0")
    expect(section).to_have_attribute(
        "data-source-archive-failure-page-revision", str(after_new_failure["revision"])
    )
    expect(section).to_have_attribute("data-source-archive-failure-total", "14")
    expect(section).to_have_attribute("data-source-archive-failure-total-pages", "2")
    expect(section).to_have_attribute("data-source-archive-failure-has-older", "true")
    expect(section).to_have_attribute("data-source-archive-failure-has-newer", "false")
    expect(cards).to_have_count(12)
    expect(cards.nth(0)).to_have_attribute(
        "data-source-archive-failure-event-id", failure["eventId"]
    )
    expect(cards.nth(11)).to_have_attribute(
        "data-source-archive-failure-event-id", failure["eventIds"][2]
    )
    expect(section).to_contain_text("Showing failure records 3–14 of 14")
    after_reset = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        after_new_failure, after_reset,
        "Refreshing Evidence Archive to the newly accepted failure snapshot"
    )

    open_observatory = card.locator('[data-source-archive-failure-open-observatory="true"]')
    expect(open_observatory).to_have_count(1)
    open_observatory.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Source Observatory' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    prefill = page.locator('#sheet-content [data-source-observatory-prefill-lead="true"]')
    expect(prefill).to_be_visible()
    expect(prefill).to_have_attribute("data-source-observatory-prefill-origin", "source-archive-failure")
    expect(prefill).to_contain_text("PREFILLED FAILURE LEAD · NOT RETAINED")
    expect(prefill).to_contain_text(failure["eventId"])
    expect(prefill).to_contain_text("not a source capture or truth verdict")
    target = page.locator('#sheet-content [data-source-observatory-record-lead]')
    expect(target).to_have_count(1)
    target.tap()
    page.wait_for_function(
        "() => document.querySelector('[data-source-observation-form]') !== null",
        timeout=30000
    )
    form = page.locator('[data-source-observation-form]')
    expect(form).to_have_attribute("data-source-observation-prefill-origin", "source-archive-failure")
    claim = page.locator("#source-observation-claim").input_value()
    source = page.locator("#source-observation-source").input_value()
    source_kind = page.locator("#source-observation-kind").input_value()
    falsifier = page.locator("#source-observation-falsifier").input_value()
    uncertainty = page.locator("#source-observation-uncertainty").input_value()
    next_test = page.locator("#source-observation-next-test").input_value()
    assert failure["failureCode"] in claim
    assert failure["eventId"] in source
    assert source_kind == "tool-output"
    assert "Git blob SHA-1" in falsifier
    assert "does not establish source availability" in uncertainty
    assert "new request ID" in next_test
    disclosure = page.locator('[data-source-observation-prefill-disclosure="source-archive-failure"]')
    expect(disclosure).to_be_visible()
    expect(disclosure).to_contain_text("not a source capture")
    expect(page.locator("#source-observation-submit")).to_have_text("Retain reviewed failure-context lead")
    after_lead = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        after_reset, after_lead,
        "Reviewing a failure-derived Source Observation lead without submitting it"
    )
    layout = assert_mobile_layout(page, width)
    page.screenshot(path=str(out / ("source-archive-failure-ledger-" + str(width) + ".png")), full_page=True)
    page.locator("#sheet-close").tap()
    return {
        "eventIds": failure["eventIds"],
        "initialVisibleCount": 12,
        "olderPageVisibleCount": 1,
        "refreshedSnapshotVisibleCount": 12,
        "eventCountAfterRevisionChange": failure["count"],
        "latestEventId": failure["eventId"],
        "oldestEventId": failure["oldestEventId"],
        "target": "Evidence Archive",
        "nextLocation": "Source Observation form",
        "prefillOrigin": "source-archive-failure",
        "submissionNotPerformed": True,
        "navigationReadOnly": True,
        "archiveLayout": archive_layout,
        "nextLayout": layout
    }


def inspect_moonshot_source_archive_failures(page, failure, width, out):
    before_route = authoritative_snapshot(page)
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to Moonshot Field", exact=True)
    expect(route).to_be_visible()
    route.tap()
    page.wait_for_function(
        """expected => {
            const world = document.querySelector('#world');
            const sheet = document.querySelector('#sheet');
            const enterButton = document.querySelector('#enter-institution-button');
            const primaryButton = document.querySelector('#interact-button');
            const separateEntry = enterButton && !enterButton.hidden &&
                enterButton.getAttribute('aria-label') === expected.ariaLabel;
            return world?.dataset.nearbyInstitutionId === expected.placeId &&
                sheet?.hidden === true &&
                (separateEntry || primaryButton?.getAttribute('aria-label') === expected.ariaLabel);
        }""",
        arg={"placeId": "moonshot_field", "ariaLabel": "Enter Moonshot Field"},
        timeout=30000
    )
    arrival = authoritative_snapshot(page)
    route_events = assert_route_travel_records_only_discoveries(
        before_route, arrival, "Walking from Evidence Archive to Moonshot Field"
    )
    enter_button = page.locator("#enter-institution-button")
    if enter_button.is_visible():
        enter_button.tap()
    else:
        page.locator("#interact-button").tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Moonshot Field' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    opened = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        arrival, opened, "Opening Moonshot Field's retained failure objects"
    )

    section = page.locator(
        '#sheet-content [data-moonshot-source-archive-failure-ledger="true"]'
    )
    expect(section).to_be_visible()
    expect(section).to_have_attribute(
        "data-moonshot-source-archive-failure-snapshot-revision", str(opened["revision"])
    )
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-total", "14")
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-page-size", "6")
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-total-pages", "3")
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-has-older", "true")
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-freshness", "current")
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-complete", "true")
    cards = section.locator('[data-moonshot-source-archive-failure-card="true"]')
    expect(cards).to_have_count(6)
    expect(cards.nth(0)).to_have_attribute(
        "data-moonshot-source-archive-failure-event-id", failure["eventId"]
    )
    expect(cards.nth(5)).to_have_attribute(
        "data-moonshot-source-archive-failure-event-id", failure["eventIds"][-6]
    )
    latest = cards.nth(0)
    expect(latest).to_have_attribute("data-moonshot-source-archive-failure-status", "retryable")
    expect(latest).to_contain_text("GitHub source unavailable")
    expect(latest).to_contain_text("GITHUB_SOURCE_UNAVAILABLE")
    expect(latest).to_contain_text("ngl-damien/No-Gas-Labs-Alpha-1")
    expect(latest).to_contain_text("failure-ledger.mjs")
    expect(latest).to_contain_text("Service-observed retrieval/build failure only")
    expect(section).to_contain_text("latest 6 of 14")
    full_ledger = section.locator(
        '[data-moonshot-source-archive-failure-open-ledger="true"]'
    )
    expect(full_ledger).to_be_visible()

    before_chronicle = authoritative_snapshot(page)
    inspect = latest.locator(
        '[data-moonshot-source-archive-failure-chronicle-event-id="' + failure["eventId"] + '"]'
    )
    expect(inspect).to_be_visible()
    inspect.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'World Chronicle' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    exact_event = page.locator(
        '#sheet-content [data-chronicle-entries] [data-event-id="world:' + failure["eventId"] + '"]'
    )
    expect(exact_event).to_have_count(1)
    expect(exact_event).to_have_attribute("data-event-id", "world:" + failure["eventId"])
    after_chronicle = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        before_chronicle, after_chronicle,
        "Inspecting a Moonshot Field failure's exact Chronicle event"
    )
    page.locator("#sheet-close").tap()

    enter_nearby_institution(page, "moonshot_field", "Moonshot Field", "Moonshot Field")
    reopened = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        after_chronicle, reopened, "Reopening Moonshot Field after Chronicle inspection"
    )
    latest_again = page.locator(
        '#sheet-content [data-moonshot-source-archive-failure-card="true"]' +
        '[data-moonshot-source-archive-failure-event-id="' + failure["eventId"] + '"]'
    )
    expect(latest_again).to_have_count(1)
    investigate = latest_again.locator(
        '[data-moonshot-source-archive-failure-investigate-event-id="' + failure["eventId"] + '"]'
    )
    expect(investigate).to_be_visible()
    before_investigation = authoritative_snapshot(page)
    investigate.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Source Observatory' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    prefill = page.locator(
        '#sheet-content [data-source-observatory-prefill-lead="true"]'
    )
    expect(prefill).to_be_visible()
    expect(prefill).to_have_attribute(
        "data-source-observatory-prefill-origin", "source-archive-failure"
    )
    expect(prefill).to_contain_text(failure["eventId"])
    expect(prefill).to_contain_text("not a source capture or truth verdict")
    after_investigation = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        before_investigation, after_investigation,
        "Opening a failure-derived research lead without submitting it"
    )
    layout = assert_mobile_layout(page, width)
    page.screenshot(
        path=str(out / ("moonshot-source-archive-failures-" + str(width) + ".png")),
        full_page=True
    )
    page.locator("#sheet-close").tap()
    return {
        "snapshotRevision": opened["revision"],
        "failureTotal": 14,
        "visibleLatestCount": 6,
        "totalPagesAtSixPerPage": 3,
        "latestEventId": failure["eventId"],
        "oldestVisibleEventId": failure["eventIds"][-6],
        "exactChronicleEventInspected": failure["eventId"],
        "investigationPrefillOrigin": "source-archive-failure",
        "investigationLeadNotSubmitted": True,
        "navigationReadOnly": True,
        "routeDiscoveries": route_events,
        "layout": layout
    }


def seed_proposal_and_report(page, width):
    before = authoritative_snapshot(page)
    assert before["viewer"]["role"] == "founder"
    baseline_xp = before["xp"]

    proposal = post_action(page, {
        "type": "propose-moonshot",
        "title": "Synthesis Clerk mobile fixture " + str(width),
        "hypothesis": "A bounded source chain can be routed to the Synthesis Clerk.",
        "falsifier": "A proposal without a linked attempt cannot produce an available synthesis packet.",
        "evidenceNeeded": "A retained attempt and a separate adversarial challenge.",
        "sourceCreationId": None,
        "sourceVersion": None,
        "requestId": "synthesis-" + str(width) + "-proposal"
    })
    moonshot_id = proposal.get("result", {}).get("moonshotId")
    assert isinstance(moonshot_id, str) and moonshot_id
    after_proposal = authoritative_snapshot(page)
    proposal_event = find_event(after_proposal, "moonshot-proposed", moonshotId=moonshot_id)
    assert proposal_event is not None
    assert proposal_event["actorId"] == before["viewer"]["id"]
    assert proposal_event["actorRole"] == "founder"
    assert len(after_proposal["eventIds"]) == len(before["eventIds"]) + 1
    assert after_proposal["xp"] == baseline_xp

    proposal_only_packet = project_synthesis_packet(page)
    assert proposal_only_packet["available"] is False, (
        "A proposal alone must not unlock Synthesis Clerk."
    )
    assert "at least one linked experiment report or challenge" in proposal_only_packet["reason"]

    report = post_action(page, {
        "type": "report-experiment",
        "moonshotId": moonshot_id,
        "procedure": "Run the disposable acceptance fixture once and retain the result.",
        "observation": "The fixture records a self-reported failed attempt; no external measurement was made.",
        "reportedOutcome": "failed",
        "evidenceCreationId": None,
        "evidenceVersion": None,
        "requestId": "synthesis-" + str(width) + "-report"
    })
    report_id = report.get("result", {}).get("reportId")
    assert isinstance(report_id, str) and report_id
    after_report = authoritative_snapshot(page)
    report_event = find_event(after_report, "experiment-reported", reportId=report_id)
    assert report_event is not None
    assert report_event["moonshotId"] == moonshot_id
    assert report_event["actorId"] == before["viewer"]["id"]
    assert report_event["actorRole"] == "founder"
    assert len(after_report["eventIds"]) == len(after_proposal["eventIds"]) + 1
    assert after_report["xp"] == baseline_xp

    packet = project_synthesis_packet(page)
    assert packet["available"] is True, packet["reason"]
    assert packet["moonshotId"] == moonshot_id
    assert set(packet["inputRefs"]) == {proposal_event["id"], report_event["id"]}
    assert packet["omittedCount"] == 0
    return {
        "moonshotId": moonshot_id,
        "proposalEventId": proposal_event["id"],
        "reportId": report_id,
        "reportEventId": report_event["id"],
        "baselineXp": baseline_xp,
        "afterReport": after_report
    }


def add_witness_challenge(page, width, fixture):
    witness = logout_to_witness(page)
    # Compare against the Witness-visible projection, not the preceding Founder
    # projection: Founder-only draft events are intentionally hidden from Witnesses.
    witness_before = authoritative_snapshot(page)
    assert witness_before["viewer"]["id"] == witness["id"]
    assert witness_before["viewer"]["role"] == "witness"
    challenge = post_action(page, {
        "type": "challenge-experiment-report",
        "reportId": fixture["reportId"],
        "challengeType": "methodology",
        "challengeText": "The fixture contains no independent measurement or control; its self-reported failure cannot establish the proposal's hypothesis.",
        "evidenceCreationId": None,
        "evidenceVersion": None,
        "requestId": "synthesis-" + str(width) + "-witness-challenge"
    })
    challenge_id = challenge.get("result", {}).get("challengeId")
    assert isinstance(challenge_id, str) and challenge_id
    after_challenge = authoritative_snapshot(page)
    challenge_event = find_event(after_challenge, "experiment-challenged", challengeId=challenge_id)
    assert challenge_event is not None
    assert challenge_event["reportId"] == fixture["reportId"]
    assert challenge_event["moonshotId"] == fixture["moonshotId"]
    assert challenge_event["actorId"] == witness["id"]
    assert challenge_event["actorRole"] == "witness"
    assert challenge_event["actorId"] != fixture["afterReport"]["viewer"]["id"]
    # Logout changes the public projection (Founder-only drafts are hidden), so
    # event deltas must be measured from the same Witness projection immediately
    # before the one challenge action.
    assert after_challenge["eventIds"][:len(witness_before["eventIds"])] == witness_before["eventIds"]
    assert after_challenge["eventIds"][len(witness_before["eventIds"]):] == [challenge_event["id"]]
    assert after_challenge["revision"] == witness_before["revision"] + 1
    assert after_challenge["xp"] == fixture["baselineXp"]

    packet = project_synthesis_packet(page)
    assert packet["available"] is True
    assert packet["moonshotId"] == fixture["moonshotId"]
    assert set(packet["inputRefs"]) == {
        fixture["proposalEventId"],
        fixture["reportEventId"],
        challenge_event["id"]
    }
    payload = json.loads(packet["packetJson"])
    assert payload["authority"] == "advisory-only"
    assert payload["mayWriteCanonicalState"] is False
    assert payload["mayGrantAuthority"] is False
    assert payload["mayAwardProgress"] is False
    assert payload["mayCertifyTruthOrExecution"] is False
    assert payload["omittedCount"] == 0
    challenge_ids = [
        record["eventId"] for record in payload["inputRecords"]
        if record["type"] == "experiment-challenged"
    ]
    assert challenge_ids == [challenge_event["id"]]
    return {
        "witnessId": witness["id"],
        "challengeId": challenge_id,
        "challengeEventId": challenge_event["id"],
        "packet": packet,
        "packetPayload": payload,
        "afterChallenge": after_challenge
    }


def return_to_founder(page, founder_id):
    page.reload(wait_until="networkidle")
    start_shared(page)
    viewer = login_founder(page)
    assert viewer["id"] == founder_id
    return authoritative_snapshot(page)


def assert_world_visible_behind_sheet(page, label):
    wait_for_shared_connection(page, label + " world-canvas readiness")
    metrics = page.evaluate("""() => {
        const world = document.querySelector('#world')
        const sheet = document.querySelector('#sheet')
        const backdrop = document.querySelector('#sheet-backdrop')
        const questCard = document.querySelector('#quest-card')
        const worldStats = document.querySelector('.world-stats')
        if (!world || !sheet || !backdrop || !questCard || !worldStats) return null
        const worldRect = world.getBoundingClientRect()
        const sheetRect = sheet.getBoundingClientRect()
        const worldStyle = getComputedStyle(world)
        const backdropStyle = getComputedStyle(backdrop)
        return {
            sheetHidden: sheet.hidden,
            sheetRole: sheet.getAttribute('role'),
            sheetAriaModal: sheet.getAttribute('aria-modal'),
            worldVisible: worldRect.width > 0 && worldRect.height > 0 &&
                worldStyle.display !== 'none' && worldStyle.visibility !== 'hidden',
            sheetTop: sheetRect.top,
            sheetHeight: sheetRect.height,
            viewportHeight: window.innerHeight,
            backdropFilter: backdropStyle.backdropFilter,
            backdropPointerEvents: backdropStyle.pointerEvents,
            worldFilter: worldStyle.filter,
            bodyModalOpen: document.body.classList.contains('modal-open'),
            worldPanelOpen: document.body.classList.contains('world-panel-open'),
            movementEnabled: world.dataset.movementEnabled,
            connectionState: document.querySelector('#connection-dot')?.dataset.connectionState || 'unknown',
            modeLabel: document.querySelector('#mode-label')?.textContent || '',
            questCardDisplay: getComputedStyle(questCard).display,
            worldStatsDisplay: getComputedStyle(worldStats).display
        }
    }""")
    assert metrics is not None, f"{label}: world/sheet/backdrop elements must exist"
    assert metrics["sheetHidden"] is False, f"{label}: institution panel must be open"
    assert metrics["sheetRole"] == "region" and metrics["sheetAriaModal"] is None, (
        f"{label}: an in-world institution panel must remain modeless: {metrics}"
    )
    assert metrics["worldVisible"], f"{label}: world canvas must remain visible behind the panel"
    assert metrics["sheetTop"] >= metrics["viewportHeight"] * 0.33, (
        f"{label}: mobile panel must leave at least one-third of the viewport for the world: {metrics}"
    )
    assert metrics["sheetHeight"] <= metrics["viewportHeight"] * 0.67, (
        f"{label}: institution panel must not consume the world viewport: {metrics}"
    )
    assert metrics["backdropFilter"] == "none", f"{label}: backdrop must not blur the world: {metrics}"
    assert metrics["backdropPointerEvents"] == "none", (
        f"{label}: the decorative backdrop must let pointer input reach the world: {metrics}"
    )
    assert metrics["worldFilter"] == "none", f"{label}: world canvas itself must not be blurred: {metrics}"
    assert metrics["bodyModalOpen"] is False, (
        f"{label}: opening an institution panel must not pause the playable world: {metrics}"
    )
    assert metrics["worldPanelOpen"] is True, f"{label}: the modeless world panel state must be explicit: {metrics}"
    assert metrics["movementEnabled"] == "true", f"{label}: local world movement must be enabled: {metrics}"
    assert metrics["connectionState"] == "online", (
        f"{label}: the shared snapshot must be fresh before the offline-preview exercise: {metrics}"
    )
    assert metrics["questCardDisplay"] == "none" and metrics["worldStatsDisplay"] == "none", (
        f"{label}: mobile world overlays must not cover the visible map context: {metrics}"
    )

    page.locator("#sheet-close").focus()
    assert page.evaluate("() => Boolean(document.activeElement?.closest('#sheet'))"), (
        f"{label}: keyboard focus should remain inside the modeless institution panel until the player selects the map."
    )
    position_before_key = authoritative_position(page)
    page.keyboard.down("w")
    page.wait_for_timeout(350)
    page.keyboard.up("w")
    page.wait_for_timeout(800)
    position_after_key = authoritative_position(page)
    assert position_after_key == position_before_key, (
        f"{label}: keyboard navigation inside the institution panel must not move the player."
    )
    expect(page.locator("#sheet")).to_be_visible()
    return metrics


def assert_offline_preview_keeps_local_route(page, label):
    # The offline/online events are synthetic browser signals. This verifies the
    # client contract, not a real carrier outage: local travel is allowed, shared
    # writes are paused, and reconnect restores the last accepted server position.
    wait_for_shared_connection(page, label + " before offline preview")
    before = authoritative_snapshot(page)
    server_before = authoritative_position(page)
    target = page.evaluate("""async () => {
        const [worldModule, pixelModule] = await Promise.all([
            import('/world-view.mjs'),
            import('/pixel-world-view.mjs')
        ])
        const canvas = document.querySelector('#world')
        const sheet = document.querySelector('#sheet')
        if (!canvas || !sheet) throw new Error('World canvas and institution sheet are required.')
        const dtoResponse = await fetch('/api/state', {
            cache: 'no-store',
            credentials: 'same-origin'
        })
        if (!dtoResponse.ok) throw new Error('Shared state read failed: ' + dtoResponse.status)
        const dto = await dtoResponse.json()
        if (!dto?.world || !Array.isArray(dto.world.creations)) {
            throw new Error('A complete world creation projection is required to select ground.')
        }
        const data = canvas.dataset
        if (data.positionSource !== 'renderer-local') {
            throw new Error('World renderer coordinates must be labeled renderer-local, not treated as shared authority.')
        }
        const player = { x: Number(data.playerX), y: Number(data.playerY) }
        const camera = { x: Number(data.cameraX), y: Number(data.cameraY) }
        const zoom = Number(data.zoom)
        const width = Number(data.viewportWidth)
        const height = Number(data.viewportHeight)
        if ([player.x, player.y, camera.x, camera.y, zoom, width, height].some(value => !Number.isFinite(value))) {
            throw new Error('World renderer position/camera telemetry is unavailable.')
        }
        const rect = canvas.getBoundingClientRect()
        const sheetRect = sheet.getBoundingClientRect()
        const presence = Array.isArray(dto.presence) ? dto.presence : []
        const selfPresenceId = String(dto.viewer?.presenceId || dto.viewer?.id || '__self__')
        const offsets = [
            [220, 80], [200, 140], [220, -80], [180, 100], [180, -120],
            [-160, 100], [-180, -80], [0, 220], [0, -220], [160, 160], [160, -160]
        ]
        for (const [dx, dy] of offsets) {
            const destination = { x: player.x + dx, y: player.y + dy }
            if (Math.hypot(dx, dy) < 80 ||
                !worldModule.isWalkable(destination.x, destination.y, dto.world.creations)) continue
            const route = worldModule.findRoute(player, destination, dto.world.creations)
            if (!Array.isArray(route) || route.length < 2) continue
            const point = {
                x: width / 2 + (destination.x - camera.x) * zoom,
                y: height / 2 + (destination.y - camera.y) * zoom
            }
            const clientX = rect.left + point.x
            const clientY = rect.top + point.y
            if (point.x < 8 || point.y < 8 || point.x > width - 8 || point.y > height - 8 ||
                clientY >= sheetRect.top - 24) continue
            if (pixelModule.projectGuildNpcPointerTarget(point, camera, zoom, width, height) ||
                pixelModule.projectInstitutionPointerTarget(point, camera, zoom, width, height) ||
                pixelModule.projectPlayerPointerTarget(
                    point, presence, selfPresenceId, camera, zoom, width, height
                )) continue
            if (document.elementFromPoint(clientX, clientY) !== canvas) continue
            return {
                x: clientX,
                y: clientY,
                world: destination,
                routeLength: route.length,
                playerBefore: player,
                positionSource: data.positionSource
            }
        }
        throw new Error('No visible, walkable ground point without an NPC, player or institution hit target.')
    }""")
    page.evaluate("() => window.dispatchEvent(new Event('offline'))")
    page.wait_for_function("""() => {
        const world = document.querySelector('#world')
        const dot = document.querySelector('#connection-dot')
        const label = document.querySelector('#mode-label')?.textContent || ''
        return world?.dataset.sharedOfflinePreview === 'true' &&
            world?.dataset.movementEnabled === 'true' &&
            dot?.dataset.connectionState === 'offline' &&
            label.includes('offline preview')
    }""", timeout=10000)
    page.touchscreen.tap(target["x"], target["y"])
    assert page.evaluate("() => document.activeElement?.id === 'world'"), (
        f"{label}: selecting the visible map should transfer keyboard control to the world canvas."
    )
    page.wait_for_function("""before => {
        const world = document.querySelector('#world')
        const x = Number(world?.dataset.playerX)
        const y = Number(world?.dataset.playerY)
        return Number.isFinite(x) && Number.isFinite(y) &&
            Math.hypot(x - before.x, y - before.y) > 16
    }""", arg=target["playerBefore"], timeout=15000)
    local_after = page.evaluate("""() => {
        const world = document.querySelector('#world')
        return {
            x: Number(world.dataset.playerX),
            y: Number(world.dataset.playerY),
            routeActive: world.dataset.routeActive === 'true'
        }
    }""")
    local_delta = math.hypot(
        local_after["x"] - target["playerBefore"]["x"],
        local_after["y"] - target["playerBefore"]["y"]
    )
    assert local_delta > 16, f"{label}: offline preview must permit local-only travel: {local_after}"
    server_during = authoritative_position(page)
    assert server_during == server_before, (
        f"{label}: offline preview must not persist local coordinates: "
        + json.dumps({"before": server_before, "during": server_during, "local": local_after})
    )
    after = authoritative_snapshot(page)
    assert_canonical_state_unchanged(before, after, label + " offline-preview travel")

    page.evaluate("() => window.dispatchEvent(new Event('online'))")
    wait_for_shared_connection(page, label + " after offline-preview recovery")
    page.wait_for_function("""expected => {
        const world = document.querySelector('#world')
        const x = Number(world?.dataset.playerX)
        const y = Number(world?.dataset.playerY)
        return Number.isFinite(x) && Number.isFinite(y) &&
            Math.hypot(x - expected.x, y - expected.y) < 1 &&
            world.dataset.routeActive === 'false'
    }""", arg=server_before, timeout=20000)
    final = authoritative_snapshot(page)
    assert_canonical_state_unchanged(before, final, label + " offline-preview reconciliation")
    return {
        "transport": "synthetic navigator offline/online events",
        "targetWorld": target["world"],
        "routeLength": target["routeLength"],
        "rendererPositionSource": target["positionSource"],
        "localMovementDelta": local_delta,
        "localRouteActiveAtCapture": local_after["routeActive"],
        "sharedPositionBefore": server_before,
        "sharedPositionDuringOffline": server_during,
        "sharedPositionAfterReconnect": authoritative_position(page),
        "canonicalStateUnchanged": True,
        "reconciledToLastAcceptedPosition": True
    }


def open_synthesis_clerk(page, packet, inspect_source_events=False):
    before = authoritative_snapshot(page)
    control = page.locator('[data-guild-npc-control="synthesizer"]')
    expect(control).to_have_count(1)
    control.evaluate("button => button.focus()")
    expect(control).to_be_visible()
    accessible_label = control.get_attribute("aria-label") or ""
    assert "Packet state: ready." in accessible_label or "Packet state: partial." in accessible_label, (
        "The in-world Synthesis Clerk control must disclose bounded packet readiness."
    )
    control.tap()
    page.wait_for_function(
        "() => document.querySelector('[data-guild-npc-control=\"synthesizer\"]')?.dataset.guildNpcAction === 'talk'",
        timeout=30000
    )
    control.evaluate("button => button.blur()")
    page.wait_for_timeout(1000)

    sheet = page.locator("#sheet")
    if sheet.is_visible():
        assert page.locator("#sheet-title").text_content() == "Guild Hall", (
            "The restored session may open the Guild Hall as soon as the accessible NPC route reaches interaction range."
        )
    else:
        # The NPC route has reached interaction range. The visible Interact
        # control now changes to Talk to Synthesis and opens the exact owning
        # workbench; the map's accessible route target is not the talk action.
        expect(control).to_have_attribute("data-guild-npc-action", "talk")
        interact_button = page.locator("#interact-button")
        expect(interact_button).to_be_visible()
        interact_label = interact_button.get_attribute("aria-label") or ""
        assert "Synthesis Clerk" in interact_label and "nearby collaborator" in interact_label, (
            "Nearby Interact must expose the exact bounded Synthesis action: " + interact_label
        )
        interact_button.tap()
        page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Guild Hall' && " +
            "!document.querySelector('#sheet').hidden",
            timeout=30000
        )
        expect(page.locator("#sheet")).to_be_visible()
        expect(page.locator("#sheet-close")).to_be_visible()
    
    arrival = authoritative_snapshot(page)
    route_discoveries = assert_route_travel_records_only_discoveries(
        before, arrival, "Walking to the Synthesis Clerk"
    )
    world_surface = assert_world_visible_behind_sheet(page, "Synthesis Clerk")

    card = page.locator('#sheet-content [data-collaborator-role="synthesizer"]')
    expect(card).to_have_count(1)
    expect(card).to_contain_text("Synthesis Clerk")
    snapshot = page.locator('#sheet-content [data-project-state-snapshot="true"]')
    expect(snapshot).to_have_count(1)
    expect(snapshot).to_contain_text("PUBLIC PROJECT STATE · SNAPSHOT")
    expect(snapshot).to_contain_text("SHA-256 RECEIPT MATCHED · NOT LIVE")
    expect(snapshot).to_have_attribute("data-project-state-status", "receipt-verified")
    expect(card).to_contain_text("Inputs:")
    for event_id in packet["inputRefs"]:
        expect(card).to_contain_text(event_id)

    packet_details = card.locator("details.collaborator-packet")
    packet_details.locator("summary").tap()
    packet_prompt = packet_details.locator("textarea").input_value()
    assert "UNTRUSTED_INPUT_JSON:" in packet_prompt
    for event_id in packet["inputRefs"]:
        assert event_id in packet_prompt

    after = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        arrival, after, "Reading the Synthesis Clerk after navigation"
    )
    source_links = card.locator('[data-source-event-context="collaborator-packet"]')
    expect(source_links).to_have_count(len(packet["inputRefs"]))
    for event_id in packet["inputRefs"]:
        source_link = card.locator('[data-source-event-id="' + event_id + '"]')
        expect(source_link).to_be_visible()
        expect(source_link).to_have_attribute("data-source-event-context", "collaborator-packet")
        expect(source_link).to_have_attribute("data-source-event-role", "synthesizer")
        expect(source_link).to_have_attribute(
            "data-source-event-snapshot-revision", str(arrival["revision"])
        )

    if inspect_source_events:
        event_id = packet["inputRefs"][0]
        source_link = card.locator('[data-source-event-id="' + event_id + '"]')
        source_link.tap()
        page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'World Chronicle' && " +
            "!document.querySelector('#sheet').hidden",
            timeout=30000
        )
        chronicle = page.locator("#sheet-content")
        expect(chronicle).to_have_attribute(
            "data-chronicle-snapshot-revision", str(arrival["revision"])
        )
        expect(chronicle.locator(
            '[data-event-id="world:' + event_id + '"]'
        )).to_be_visible()
        after_chronicle = authoritative_snapshot(page)
        assert_canonical_state_unchanged(
            after, after_chronicle,
            "Opening a collaborator packet input in its exact retained Chronicle snapshot"
        )
        page.locator("#sheet-close").tap()
        interact_button = page.locator("#interact-button")
        expect(interact_button).to_be_visible()
        interact_label = interact_button.get_attribute("aria-label") or ""
        assert "Synthesis Clerk" in interact_label and "nearby collaborator" in interact_label, (
            "Returning from Chronicle must preserve the explicit Synthesis Clerk interaction."
        )
        interact_button.tap()
        page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Guild Hall' && " +
            "!document.querySelector('#sheet').hidden",
            timeout=30000
        )
        card = page.locator('#sheet-content [data-collaborator-role="synthesizer"]')
        expect(card).to_be_visible()
        after_return = authoritative_snapshot(page)
        assert_canonical_state_unchanged(
            after_chronicle, after_return,
            "Returning from a collaborator source event to Guild Hall"
        )
        after = after_return

    after["npcRouteDiscoveries"] = route_discoveries
    after["worldSurface"] = world_surface
    return card, after

def record_project_state_lead(page, founder_id, observatory):
    snapshot = page.locator('#sheet-content [data-project-state-snapshot="true"]')
    expect(snapshot).to_have_attribute("data-project-state-status", "receipt-verified")
    captured_at = snapshot.get_attribute("data-project-state-captured-at")
    receipt_digest = snapshot.get_attribute("data-project-state-receipt-digest")
    lead_buttons = snapshot.locator('[data-project-state-record-lead="pullRequests"]')
    assert lead_buttons.count() > 0, "The captured project snapshot must expose a PR lead with an exact head commit."
    lead_button = lead_buttons.first
    source_key = lead_button.get_attribute("data-project-state-record-lead")
    record_url = lead_button.get_attribute("data-project-state-record-url")
    head_sha = lead_button.get_attribute("data-project-state-record-head-sha")
    base_sha = lead_button.get_attribute("data-project-state-record-base-sha")
    head_url = lead_button.get_attribute("data-project-state-record-head-url")
    check_sha = lead_button.get_attribute("data-project-state-record-check-sha")
    check_status = lead_button.get_attribute("data-project-state-record-check-status")
    check_captured_at = lead_button.get_attribute("data-project-state-record-check-captured-at")
    check_summary = lead_button.get_attribute("data-project-state-record-check-summary")
    assert source_key == "pullRequests"
    assert record_url and record_url.startswith("https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/")
    assert len(head_sha or "") == 40 and all(character in "0123456789abcdef" for character in head_sha)
    assert len(base_sha or "") == 40 and all(character in "0123456789abcdef" for character in base_sha)
    assert head_url == "https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/commit/" + head_sha
    assert check_sha == head_sha, "The check inventory must be bound to the exact captured PR head."
    assert check_status in {"unavailable", "failure-reported", "waiting", "checks-reported-success", "incomplete"}
    assert check_captured_at, "The selected recent PR must carry an exact-head check capture time."
    assert check_summary and "EXACT-HEAD CHECKS" in check_summary

    before = authoritative_snapshot(page)
    wait_for_shared_connection(page, "Source Observatory lead handoff")
    lead_button.tap()
    # Reaching a landmark is navigation only. The player must explicitly
    # interact with the nearby institution to open its workbench.
    page.wait_for_function(
        "() => document.querySelector('#world')?.dataset.nearbyInstitutionId === 'source_observatory' && " +
        "((document.querySelector('#enter-institution-button') && !document.querySelector('#enter-institution-button').hidden && document.querySelector('#enter-institution-button').getAttribute('aria-label') === 'Enter Source Observatory') || " +
        "document.querySelector('#interact-button')?.getAttribute('aria-label') === 'Enter Source Observatory') && " +
        "document.querySelector('#sheet')?.hidden === true",
        timeout=30000
    )
    arrival_state = authoritative_snapshot(page)
    expect(page.locator("#sheet")).to_be_hidden()
    enter_button = page.locator('#enter-institution-button')
    if enter_button.is_visible():
        enter_button.tap()
    else:
        page.locator('#interact-button').tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Source Observatory' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    after_interaction = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        arrival_state, after_interaction,
        "Explicitly entering Source Observatory after navigation"
    )
    prepared = page.locator('[data-source-observatory-prefill-lead="true"]')
    expect(prepared).to_be_visible()
    expect(prepared).to_contain_text("PREFILLED SNAPSHOT LEAD · NOT RETAINED")
    expect(prepared).to_contain_text("Possible falsifier:")
    expect(prepared).to_contain_text("Next discriminating test:")
    expect(prepared).to_contain_text("not live")
    after_prepare = authoritative_snapshot(page)
    route_discoveries = assert_route_travel_records_only_discoveries(
        before, after_prepare, "Walking from Guild Hall to Source Observatory with a prepared project-state lead"
    )

    target_button = page.locator("[data-source-observatory-record-lead]")
    expect(target_button).to_have_count(1)
    target_key = target_button.get_attribute("data-source-observatory-record-lead")
    assert target_key == observatory["creationId"] + "@1", (
        "The player must choose the exact retained Observatory version; no substitute is inferred."
    )
    target_button.tap()
    page.wait_for_function(
        "() => document.querySelector('[data-source-observation-form]') !== null",
        timeout=30000
    )
    form = page.locator("[data-source-observation-form]")
    expect(form).to_have_attribute("data-source-observation-prefill-origin", "project-state-snapshot")
    expect(form).to_have_attribute("data-source-observation-creation-id", observatory["creationId"])
    expect(form).to_have_attribute("data-source-observation-version", "1")
    claim = page.locator("#source-observation-claim").input_value()
    source = page.locator("#source-observation-source").input_value()
    source_kind = page.locator("#source-observation-kind").input_value()
    falsifier = page.locator("#source-observation-falsifier").input_value()
    uncertainty = page.locator("#source-observation-uncertainty").input_value()
    next_test = page.locator("#source-observation-next-test").input_value()
    assert claim.startswith("Build snapshot ") and head_sha in claim
    assert record_url in source
    assert head_sha in source and head_url in source and base_sha in source
    assert check_status in source and check_captured_at in source
    assert check_summary in claim, "The full check summary remains visible in the lead claim."
    assert len(source) <= 500, "Source Observation attribution must fit its 500-character field bound."
    assert len(claim) <= 500, "Source Observation claim must fit its 500-character field bound."
    assert captured_at in source
    assert receipt_digest in source
    assert source_kind == "tool-output"
    assert falsifier and "exact head SHA" in falsifier
    assert uncertainty and "not live" in uncertainty
    assert next_test and "current PR head" in next_test and "exact commit" in next_test
    assert "check-run and commit-status inventory" in next_test
    disclosure = page.locator('[data-source-observation-prefill-disclosure="project-state-snapshot"]')
    expect(disclosure).to_be_visible()
    expect(disclosure).to_contain_text("not live")
    expect(disclosure).to_contain_text("not independently")

    before_submit = authoritative_snapshot(page)
    assert_canonical_state_unchanged(after_prepare, before_submit, "Selecting an exact Observatory version and reviewing the prefilled Source Observation form")
    wait_for_shared_connection(page, "explicit Source Observation submission")
    page.locator("#source-observation-submit").tap()
    page.wait_for_function(
        "(expected) => document.querySelector('#sheet-title')?.textContent === expected",
        arg=observatory["title"],
        timeout=30000
    )
    expect(page.locator("#source-observations")).to_contain_text(claim)
    after_submit = authoritative_snapshot(page)
    added = after_submit["retainedEvents"][len(before_submit["retainedEvents"]):]
    assert len(added) == 1, "Only explicit submission may append the one source-observation event."
    event = added[0]
    assert event["type"] == "source-observation-recorded"
    assert event["actor"]["id"] == founder_id
    assert event["actor"]["role"] == "founder"
    assert event["creationId"] == observatory["creationId"]
    assert event["version"] == 1
    assert event["claim"] == claim
    assert event["sourceKind"] == "tool-output"
    assert event["source"] == source
    assert event["falsifier"] == falsifier
    assert event["uncertainty"] == uncertainty
    assert event["nextTest"] == next_test
    assert event["sourceRetrieval"] == "NOT_PERFORMED"
    assert event["independentVerification"] == "NOT_PERFORMED"
    assert event["modelAssertions"] == "LEADS_ONLY"
    assert event["execution"] == "NOT_EXECUTED"
    assert event["originSchema"] == "ngl.source-observatory.v2"
    assert event["bindingMode"] == "SERVER_SESSION_RECEIPT"
    assert event["sourceSnapshotRevision"] == before_submit["revision"]
    receipt_digest = event.get("sourceSnapshotReceiptDigest")
    assert isinstance(receipt_digest, str) and len(receipt_digest) == 64 and all(
        character in "0123456789abcdef" for character in receipt_digest
    ), "A server-session binding must retain only the digest of its snapshot receipt."
    assert "sourceSnapshotReceipt" not in event, "The ephemeral bearer token must not enter canonical history."
    assert event["observationId"].startswith("source-observation-")
    assert event["normalizedRecordDigest"] == event["observationId"].removeprefix("source-observation-")
    assert after_submit["revision"] == before_submit["revision"] + 1
    assert after_submit["eventIds"][:len(before_submit["eventIds"])] == before_submit["eventIds"]
    assert event["id"] in after_submit["eventIds"]
    assert after_submit["xp"] == before_submit["xp"], "Recording a source lead must award no XP."
    return {
        "eventId": event["id"],
        "observationId": event["observationId"],
        "sourceKey": source_key,
        "recordUrl": record_url,
        "headSha": head_sha,
        "baseSha": base_sha,
        "headCommitUrl": head_url,
        "checkSha": check_sha,
        "checkStatus": check_status,
        "checkCapturedAt": check_captured_at,
        "checkSummary": check_summary,
        "capturedAt": captured_at,
        "receiptDigest": receipt_digest,
        "routeDiscoveryEventIds": [item["eventId"] for item in route_discoveries],
        "creationId": event["creationId"],
        "version": event["version"],
        "sourceKind": event["sourceKind"],
        "falsifier": event["falsifier"],
        "uncertainty": event["uncertainty"],
        "nextTest": event["nextTest"],
        "sourceRetrieval": event["sourceRetrieval"],
        "independentVerification": event["independentVerification"],
        "modelAssertions": event["modelAssertions"],
        "execution": event["execution"],
        "xpDelta": after_submit["xp"] - before_submit["xp"]
    }, after_submit


def open_relay(page, before):
    sheet = page.locator("#sheet")
    if sheet.is_visible():
        page.locator("#sheet-close").tap()
    expect(sheet).to_be_hidden()
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to The Relay", exact=True)
    expect(route).to_be_visible()
    route.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Carry the question.' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    after = wait_for_stable_world_snapshot(page)
    discoveries = assert_route_travel_records_only_discoveries(
        before, after, "Walking to The Relay"
    )
    return after, discoveries


def build_review_response(packet_payload, packet, report_event_id):
    challenge_ids = [
        record["eventId"] for record in packet_payload["inputRecords"]
        if record["type"] == "experiment-challenged"
    ]
    response = {
        "scope": {
            "moonshotId": packet["moonshotId"],
            "includedEventIds": packet_payload["inputRefs"],
            "omittedEventIds": packet_payload["omittedEventIds"]
        },
        "recordedSupport": [{
            "sourceEventIds": [report_event_id],
            "statement": "The retained report records a failed attempt; this describes the event, not proof of the reported observation."
        }],
        "contradictions": [],
        "dissentPreserved": challenge_ids,
        "unknowns": [
            "No independent source observation or external execution was supplied.",
            "The retained methodological challenge is dissent, not an adjudication."
        ],
        "nextDiscriminatingExperiment": {
            "procedure": "Repeat with a pre-specified control and an independently retained raw observation.",
            "outcome": "Compare the raw result with the proposal's falsifier and preserve support, contradiction, failure, and inconclusive outcomes separately."
        }
    }
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))


def validate_and_archive(page, card, packet, packet_payload, report_event_id, founder_id, width, out):
    response_text = build_review_response(packet_payload, packet, report_event_id)
    response_details = card.locator("details.collaborator-response")
    response_details.locator("summary").tap()
    response_field = card.locator('textarea[aria-label="Synthesis Clerk response JSON"]')
    response_field.fill(response_text)

    before_validation = authoritative_snapshot(page)
    card.locator('[data-validate-collaborator="synthesizer"]').tap()
    status = card.locator('[data-collaborator-response-status="synthesizer"]')
    expect(status).to_contain_text("STRUCTURE VALID · FOR HUMAN REVIEW ONLY")
    expect(status).to_contain_text("No claim, execution, world change, XP, or authority was verified.")
    after_validation = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        before_validation, after_validation, "Validating the pasted Synthesis Clerk response"
    )

    # The upstream server commits the response, then this browser receives a
    # synthetic 503. This models an uncertain post-commit outcome without
    # claiming that a physical network was disconnected.
    lost_response = {
        "remaining": True,
        "first_payload": None,
        "first_status": None,
        "first_response": None,
        "retry_payload": None,
        "retry_status": None,
        "retry_response": None,
        "unexpected_retries": []
    }

    def lose_synthesis_response(route):
        try:
            payload = route.request.post_data_json
        except Exception:
            payload = {}
        if not isinstance(payload, dict) or payload.get("type") != "record-collaborator-response":
            route.continue_()
            return
        if lost_response["remaining"]:
            lost_response["first_payload"] = payload
            committed = route.fetch()
            lost_response["first_status"] = committed.status
            lost_response["first_response"] = committed.json()
            lost_response["remaining"] = False
            route.fulfill(
                status=503,
                content_type="application/json",
                body=json.dumps({
                    "error": {
                        "code": "SIMULATED_RESPONSE_LOSS",
                        "message": "Synthesis response lost after commit."
                    }
                })
            )
            return
        if lost_response["retry_payload"] is None:
            lost_response["retry_payload"] = payload
            replay = route.fetch()
            lost_response["retry_status"] = replay.status
            lost_response["retry_response"] = replay.json()
            route.fulfill(response=replay)
            return
        lost_response["unexpected_retries"].append(payload)
        route.continue_()

    page.route("**/api/action", lose_synthesis_response)
    card.locator('[data-archive-collaborator="synthesizer"]').tap()
    expect(page.locator("#toast")).to_contain_text("Synthesis response lost after commit")
    assert lost_response["remaining"] is False, (
        "The simulated response failure must happen only after the server commits the response."
    )
    assert lost_response["first_status"] == 200, (
        "The upstream Synthesis response action must commit successfully before the synthetic 503."
    )
    first_payload = lost_response["first_payload"]
    first_response = lost_response["first_response"]
    assert isinstance(first_payload, dict) and first_payload.get("requestId"), (
        "The first committed response must carry the Relay's stable request ID."
    )
    assert first_response.get("idempotentReplay") is False, (
        "The first server response must represent a new commit, not a replay."
    )
    first_result = first_response.get("result", {})
    assert first_result.get("validationStatus") == "valid-for-human-review"
    assert isinstance(first_result.get("responseId"), str) and first_result["responseId"]

    pending_raw = page.evaluate(
        "localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"
    )
    assert pending_raw, "A committed response with a lost reply must retain its local Relay receipt."
    pending = json.loads(pending_raw)
    expected_action = dict(first_payload)
    first_request_id = expected_action.pop("requestId")
    assert pending["actorId"] == founder_id and pending["actorRole"] == "founder"
    assert pending["requestId"] == first_request_id
    assert pending["action"] == expected_action, (
        "The local receipt must preserve the exact original action, excluding only its separate request ID."
    )
    assert pending["action"]["type"] == "record-collaborator-response"
    assert pending["action"]["responseText"] == response_text
    assert pending["action"]["sourceEventIds"] == packet["inputRefs"]

    committed_before_retry = authoritative_snapshot(page)
    assert committed_before_retry["revision"] == before_validation["revision"] + 1
    assert len(committed_before_retry["eventIds"]) == len(before_validation["eventIds"]) + 1
    assert committed_before_retry["xp"] == before_validation["xp"]
    assert committed_before_retry["creationIds"] == before_validation["creationIds"]
    committed_event = find_event(
        committed_before_retry, "collaborator-response-recorded", role="synthesizer"
    )
    assert committed_event is not None
    assert committed_event["responseId"] == first_result["responseId"]
    assert committed_event["id"] in set(committed_before_retry["eventIds"]) - set(before_validation["eventIds"])
    request_events = [
        event for event in committed_before_retry["retainedEvents"]
        if event.get("requestId") == first_request_id
    ]
    assert len(request_events) == 1, (
        "The server must retain exactly one canonical event for the uncertain request ID."
    )

    # Exercise the mobile lifecycle recovery path: the server has committed,
    # the browser has lost the response, and the player leaves the current page.
    # The exact actor-bound receipt must survive reload and be replayed when the
    # authenticated shared world is re-entered; no manual Relay visit is needed.
    assert lost_response["retry_payload"] is None, (
        "The client must not silently retry the uncertain action before re-entry."
    )
    assert page.evaluate(
        "localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"
    ) == pending_raw, "The exact Relay receipt must remain unchanged after response loss."
    page.reload(wait_until="networkidle")
    assert page.evaluate(
        "localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"
    ) == pending_raw, "Reload must preserve the exact pending action and request ID."
    start_shared(page)
    expect(page.locator("#toast")).to_contain_text(
        "The Relay recovered the exact pending action after reconnection."
    )
    page.wait_for_function(
        "() => !localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"
    )
    assert not page.evaluate(
        "localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"
    ), "Successful automatic recovery must clear the local receipt."
    relay_state = authoritative_snapshot(page)

    retry_payload = lost_response["retry_payload"]
    retry_response = lost_response["retry_response"]
    assert lost_response["retry_status"] == 200
    assert retry_payload == first_payload, (
        "The Relay must resend the exact original action and request ID, not reconstruct a new action."
    )
    assert retry_response.get("requestId") == first_request_id
    assert retry_response.get("idempotentReplay") is True, (
        "The server must identify the second request as an idempotent replay."
    )
    assert retry_response.get("result") == first_result, (
        "The replay must return the original response result."
    )
    assert not lost_response["unexpected_retries"], (
        "The Relay should need exactly one recovery replay for this uncertain response."
    )

    after_retry = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        committed_before_retry, after_retry,
        "Re-entering the shared world and automatically replaying the exact Synthesis response"
    )
    recovered_event = find_event(
        after_retry, "collaborator-response-recorded", role="synthesizer"
    )
    assert recovered_event is not None
    assert recovered_event["id"] == committed_event["id"]
    assert recovered_event["responseId"] == first_result["responseId"]
    assert recovered_event["responseText"] == response_text
    assert len([
        event for event in after_retry["retainedEvents"]
        if event.get("requestId") == first_request_id
    ]) == 1

    # A packet is bound to the exact current world snapshot. The first
    # response makes the pre-archive packet stale; the server must reject it
    # without appending an event. Reproject before making a new attempt.
    page.unroute("**/api/action", lose_synthesis_response)
    rejected_response_text = "{}"
    stale_packet_result = page.evaluate("""async action => {
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action)
      });
      return { status: response.status, payload: await response.json() };
    }""", {
        "type": "record-collaborator-response",
        "role": "synthesizer",
        "moonshotId": packet["moonshotId"],
        "packetJson": packet["packetJson"],
        "sourceEventIds": packet["inputRefs"],
        "responseText": rejected_response_text,
        "requestId": "synthesis-" + str(width) + "-stale-packet"
    })
    assert stale_packet_result["status"] == 409
    assert stale_packet_result["payload"].get("error", {}).get("code") == "STALE_COLLABORATOR_PACKET"
    after_stale_packet = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        after_retry, after_stale_packet,
        "Submitting a response against the stale pre-archive collaborator packet"
    )

    packet = project_synthesis_packet(page)
    assert packet["available"] is True
    assert packet["moonshotId"] == recovered_event["moonshotId"]
    assert packet["inputRefs"] == recovered_event["sourceEventIds"]
    rejected_request_id = "synthesis-" + str(width) + "-rejected"
    rejected_result = post_action(page, {
        "type": "record-collaborator-response",
        "role": "synthesizer",
        "moonshotId": packet["moonshotId"],
        "packetJson": packet["packetJson"],
        "sourceEventIds": packet["inputRefs"],
        "responseText": rejected_response_text,
        "requestId": rejected_request_id
    })
    rejected_response_id = rejected_result.get("result", {}).get("responseId")
    assert isinstance(rejected_response_id, str) and rejected_response_id
    assert rejected_result.get("result", {}).get("validationStatus") == "rejected", (
        "The deliberately incomplete response must be retained as a rejected attempt."
    )
    after_rejected = authoritative_snapshot(page)
    rejected_event = find_event(
        after_rejected,
        "collaborator-response-recorded",
        role="synthesizer",
        responseId=rejected_response_id
    )
    assert rejected_event is not None
    assert rejected_event["validationStatus"] == "rejected"
    assert rejected_event["responseText"] == rejected_response_text
    assert rejected_event["actorId"] == founder_id
    assert rejected_event["actorRole"] == "founder"
    assert after_rejected["revision"] == after_retry["revision"] + 1
    assert len(after_rejected["eventIds"]) == len(after_retry["eventIds"]) + 1
    assert after_rejected["xp"] == after_retry["xp"], (
        "A rejected collaborator attempt must not award XP."
    )
    assert len([
        event for event in after_rejected["retainedEvents"]
        if event.get("requestId") == rejected_request_id
    ]) == 1

    page.reload(wait_until="networkidle")
    start_shared(page)
    reentered_state = authoritative_snapshot(page)
    reentered_founder = reentered_state["viewer"]
    if reentered_founder["id"] != founder_id or reentered_founder["role"] != "founder":
        reentered_founder = login_founder(page)
    assert reentered_founder["id"] == founder_id
    assert reentered_founder["role"] == "founder"
    card, after_reopen = open_synthesis_clerk(page, packet, inspect_source_events=True)
    reopened_event = find_event(
        after_reopen,
        "collaborator-response-recorded",
        role="synthesizer",
        responseId=first_result["responseId"]
    )
    rejected_reopened_event = find_event(
        after_reopen,
        "collaborator-response-recorded",
        role="synthesizer",
        responseId=rejected_response_id
    )
    assert reopened_event is not None, (
        "Reopening the NPC must still expose the retained response in canonical world history."
    )
    assert reopened_event["id"] == recovered_event["id"]
    assert reopened_event["responseId"] == recovered_event["responseId"]
    assert reopened_event["responseText"] == response_text
    assert rejected_reopened_event is not None
    assert rejected_reopened_event["id"] == rejected_event["id"]
    assert rejected_reopened_event["responseText"] == rejected_response_text
    assert rejected_reopened_event["validationStatus"] == "rejected"
    status = card.locator('[data-collaborator-response-status="synthesizer"]')
    expect(status).to_contain_text("Pasted output remains untrusted.")
    expect(status).to_contain_text("Validation checks structure and packet references only.")

    # Reopening the institutional NPC must rehydrate the actor's retained
    # attempt from canonical history, not merely recreate an empty response form.
    retained = card.locator('[data-retained-collaborator-response="true"]')
    expect(retained).to_have_count(2)
    valid_retained = card.locator(
        '[data-retained-collaborator-response="true"][data-retained-collaborator-event-id="' +
        recovered_event["id"] + '"]'
    )
    rejected_retained = card.locator(
        '[data-retained-collaborator-response="true"][data-retained-collaborator-event-id="' +
        rejected_event["id"] + '"]'
    )
    expect(valid_retained).to_have_count(1)
    expect(valid_retained).to_have_attribute("data-retained-collaborator-response-id", recovered_event["responseId"])
    expect(valid_retained).to_have_attribute("data-retained-collaborator-status", "valid-for-human-review")
    expect(valid_retained).to_contain_text("STRUCTURE VALID · HUMAN REVIEW ONLY")
    response_details = valid_retained.locator("details.collaborator-response")
    response_details.locator("summary").tap()
    expect(response_details.locator("textarea")).to_have_value(response_text)

    expect(rejected_retained).to_have_count(1)
    expect(rejected_retained).to_have_attribute("data-retained-collaborator-response-id", rejected_event["responseId"])
    expect(rejected_retained).to_have_attribute("data-retained-collaborator-status", "rejected")
    expect(rejected_retained).to_contain_text("REJECTED · PRESERVED ATTEMPT")
    rejected_details = rejected_retained.locator("details.collaborator-response")
    rejected_details.locator("summary").tap()
    expect(rejected_details.locator("textarea")).to_have_value(rejected_response_text)

    page.locator('[data-enter-council-chamber="true"]').tap()
    expect(page.locator("#sheet-title")).to_have_text("Council Chamber")
    council_response = page.locator('[data-council-role="synthesizer"]')
    expect(council_response).to_have_count(1)
    expect(council_response).to_have_attribute("data-council-status", "human-review")
    expect(council_response).to_have_attribute("data-council-event-id", recovered_event["id"])
    expect(council_response).to_have_attribute("data-council-response-id", recovered_event["responseId"])
    expect(council_response).to_contain_text("STRUCTURE VALID · HUMAN REVIEW ONLY")
    expect(page.locator('[data-council-coverage-progress="1/4"]')).to_have_count(1)

    after_archive = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        after_reopen, after_archive, "Reopening the Synthesis Clerk after a retained response"
    )
    page.screenshot(path=str(out / ("synthesis-clerk-" + str(width) + ".png")), full_page=True)
    return {
        "responseId": recovered_event["responseId"],
        "responseEventId": recovered_event["id"],
        "validationStatus": recovered_event["validationStatus"],
        "rejectedResponseId": rejected_event["responseId"],
        "rejectedResponseEventId": rejected_event["id"],
        "rejectedValidationStatus": rejected_event["validationStatus"],
        "retainedAttemptCount": 2,
        "rejectedAttemptPreserved": True,
        "sourceEventIds": recovered_event["sourceEventIds"],
        "worldRevision": after_archive["revision"],
        "xp": after_archive["xp"],
        "retainedUntrustedResponse": True,
        "lostResponseRecovery": {
            "simulation": "post-commit HTTP 503 followed by reload and shared-session re-entry; not a physical network test",
            "recoveryTrigger": "shared-session-reentry",
            "firstServerStatus": lost_response["first_status"],
            "firstRequestId": first_request_id,
            "retryRequestId": retry_response.get("requestId"),
            "sameExactActionAndRequestId": retry_payload == first_payload,
            "firstResponseWasNewCommit": first_response.get("idempotentReplay") is False,
            "retryWasIdempotentReplay": retry_response.get("idempotentReplay") is True,
            "responseIdPreserved": retry_response.get("result", {}).get("responseId") == first_result["responseId"],
            "pendingReceiptCleared": True,
            "canonicalEventsForRequest": len([
                event for event in after_archive["retainedEvents"]
                if event.get("requestId") == first_request_id
            ]),
            "relayDiscoveries": [],
            "xpDelta": after_archive["xp"] - before_validation["xp"]
        }
    }, after_archive

def open_quest_board(page):
    sheet = page.locator("#sheet")
    if sheet.is_visible():
        page.locator("#sheet-close").tap()
    expect(sheet).to_be_hidden()
    page.bring_to_front()
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to Quest Board", exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, "quest_board", "Quest Board", "Quest Board")
    return wait_for_stable_world_snapshot(page)


def inspect_founder_progress(page, after_archive, source_observation_event_id, width, out):
    after_arrival = open_quest_board(page)
    travel_discoveries = assert_route_travel_records_only_discoveries(
        after_archive, after_arrival, "Walking to the Founder Quest Board"
    )
    row = page.locator('#sheet-content [data-objective-id="founder-multi-source-synthesis"]')
    expect(row).to_have_count(1)
    expect(row.locator(".quest-step-state")).to_have_text("RECORDED")
    expect(row).to_contain_text("1/1")
    source_row = page.locator('#sheet-content [data-objective-id="founder-source-observation"]')
    expect(source_row).to_have_count(1)
    expect(source_row.locator(".quest-step-state")).to_have_text("RECORDED")
    expect(source_row).to_contain_text("1/1")
    after_board = authoritative_snapshot(page)
    assert source_observation_event_id in after_board["eventIds"], (
        "The Founder quest must be backed by the retained source-observation event."
    )
    assert_canonical_state_unchanged(after_arrival, after_board, "Reading the Founder Quest Board")
    page.screenshot(path=str(out / ("synthesis-quest-board-" + str(width) + ".png")), full_page=True)

    page.locator("#sheet-close").tap()
    page.locator("#character-button").tap()
    expect(page.locator("#sheet-title")).to_have_text("Character & field record")
    skill_heading = page.get_by_role("heading", name="Synthesis", exact=True)
    expect(skill_heading).to_have_count(1)
    skill_card = skill_heading.locator("xpath=..")
    expect(skill_card).to_contain_text("2 recorded multi-source Synthesis Clerk attempts")
    after_character = authoritative_snapshot(page)
    assert_canonical_state_unchanged(after_board, after_character, "Reading the Founder character record")
    page.screenshot(path=str(out / ("synthesis-character-" + str(width) + ".png")), full_page=True)
    return {
        "questObjective": "founder-multi-source-synthesis",
        "questStatus": "RECORDED",
        "questProgress": "1/1",
        "sourceObservationObjective": "founder-source-observation",
        "sourceObservationStatus": "RECORDED",
        "sourceObservationProgress": "1/1",
        "sourceObservationEventId": source_observation_event_id,
        "synthesisSkillCount": 2,
        "routeDiscoveries": travel_discoveries
    }


def append_witness_moonshot_revision(page, width, suffix):
    before = authoritative_snapshot(page)
    assert before["viewer"]["role"] == "witness"
    result = post_action(page, {
        "type": "propose-moonshot",
        "title": "Witness snapshot pin fixture " + str(width) + "-" + suffix,
        "hypothesis": "A failure card must preserve the accepted snapshot from which it was opened.",
        "falsifier": "A later accepted revision silently replaces the failure card's source snapshot.",
        "evidenceNeeded": "The exact pinned revision and an explicit refresh receipt.",
        "sourceCreationId": None,
        "sourceVersion": None,
        "requestId": "witness-moonshot-snapshot-" + str(width) + "-" + suffix
    })
    moonshot_id = result.get("result", {}).get("moonshotId")
    assert isinstance(moonshot_id, str) and moonshot_id
    after = authoritative_snapshot(page)
    assert after["revision"] == before["revision"] + 1
    assert after["xp"] == before["xp"], "a proposal must not award XP"
    event = find_event(after, "moonshot-proposed", moonshotId=moonshot_id)
    assert event is not None and event["actorId"] == before["viewer"]["id"]
    page.wait_for_function(
        "(revision) => document.querySelector('#world')?.dataset.worldRevision === String(revision)",
        arg=after["revision"],
        timeout=30000
    )
    return after


def open_witness_moonshot_field(page, stage):
    before_route = authoritative_snapshot(page)
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to Moonshot Field", exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, "moonshot_field", "Moonshot Field", "Moonshot Field")
    arrival = authoritative_snapshot(page)
    route_events = assert_route_travel_records_only_discoveries(
        before_route, arrival, stage
    )
    opened = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        arrival, opened, "Opening the Witness Moonshot Field failure objects"
    )
    return opened, route_events


def inspect_witness_moonshot_failure_history(page, failure_event_id, width, out):
    opened, route_discoveries = open_witness_moonshot_field(
        page, "Walking from the Witness Quest Board to Moonshot Field"
    )
    section = page.locator(
        '#sheet-content [data-moonshot-source-archive-failure-ledger="true"]'
    )
    expect(section).to_be_visible()
    projection = page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Witness Moonshot snapshot read failed: ' + response.status);
      const dto = await response.json();
      const { projectSourceArchiveFailureObjects } = await import('/world-view.mjs');
      const result = projectSourceArchiveFailureObjects(dto.world, { limit: 6, page: 0 });
      if (!result) return null;
      return {
        complete: result.complete,
        unseenEventCount: result.unseenEventCount,
        total: result.total,
        eventIds: result.records.map(record => record.eventId)
      };
    }""")
    assert projection is not None
    assert projection["complete"] is False, (
        "The Witness fixture must retain an intentionally partial world projection."
    )
    assert projection["unseenEventCount"] > 0
    assert failure_event_id in projection["eventIds"]
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-complete", "false")
    expect(section).to_have_attribute("data-moonshot-source-archive-failure-scope", "partial")
    expect(section).to_have_attribute(
        "data-moonshot-source-archive-failure-unseen-event-count",
        str(projection["unseenEventCount"])
    )
    expect(section).to_have_attribute(
        "data-moonshot-source-archive-failure-snapshot-revision",
        str(opened["revision"])
    )
    expect(section).to_contain_text("visible in this partial player snapshot")
    expect(section).to_contain_text("not a global failure count or newest-order claim")
    assert "Showing latest" not in (section.text_content() or "")
    cards = section.locator('[data-moonshot-source-archive-failure-card="true"]')
    expect(cards).to_have_count(6)
    target_card = section.locator(
        '[data-moonshot-source-archive-failure-card="true"]' +
        '[data-moonshot-source-archive-failure-event-id="' + failure_event_id + '"]'
    )
    expect(target_card).to_have_count(1)

    before_first_append = authoritative_snapshot(page)
    after_first_append = append_witness_moonshot_revision(page, width, "chronicle")
    assert after_first_append["revision"] > opened["revision"]
    notice = page.locator(
        '#sheet-content [data-moonshot-snapshot-notice="true"]'
    )
    expect(notice).to_be_visible()
    expect(notice).to_have_attribute("data-moonshot-snapshot-freshness", "refresh-required")
    expect(notice).to_contain_text("pinned to revision " + str(opened["revision"]))
    expect(section).to_have_attribute(
        "data-moonshot-source-archive-failure-freshness", "refresh-required"
    )

    inspect = target_card.locator(
        '[data-moonshot-source-archive-failure-chronicle-event-id="' + failure_event_id + '"]'
    )
    expect(inspect).to_be_visible()
    before_chronicle = authoritative_snapshot(page)
    inspect.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'World Chronicle' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    chronicle = page.locator("#sheet-content")
    expect(chronicle).to_have_attribute(
        "data-chronicle-snapshot-revision", str(opened["revision"])
    )
    expect(chronicle).to_have_attribute(
        "data-chronicle-snapshot-freshness-reason", "revision-mismatch"
    )
    exact_event = chronicle.locator(
        '[data-chronicle-entries] [data-event-id="world:' + failure_event_id + '"]'
    )
    expect(exact_event).to_have_count(1)
    refresh_chronicle = chronicle.locator('[data-chronicle-snapshot-refresh="true"]')
    expect(refresh_chronicle).to_be_visible()
    expect(refresh_chronicle).to_be_enabled()
    after_chronicle_open = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        before_chronicle, after_chronicle_open,
        "Opening a partial-snapshot failure in its exact pinned Chronicle"
    )
    refresh_chronicle.tap()
    expect(chronicle).to_have_attribute(
        "data-chronicle-snapshot-revision", str(after_first_append["revision"])
    )
    expect(chronicle).to_have_attribute(
        "data-chronicle-snapshot-freshness-reason", "current"
    )
    expect(refresh_chronicle).to_be_hidden()
    after_chronicle_refresh = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        after_chronicle_open, after_chronicle_refresh,
        "Explicitly refreshing the pinned failure Chronicle"
    )
    page.locator("#sheet-close").tap()

    enter_nearby_institution(page, "moonshot_field", "Moonshot Field", "Moonshot Field")
    opened_archive_source = authoritative_snapshot(page)
    after_second_append = append_witness_moonshot_revision(page, width, "archive")
    full_ledger = page.locator(
        '#sheet-content [data-moonshot-source-archive-failure-open-ledger="true"]'
    )
    expect(full_ledger).to_be_visible()
    expect(full_ledger).to_contain_text("Open visible failure pages")
    before_archive = authoritative_snapshot(page)
    full_ledger.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Evidence Archive' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    archive = page.locator("#sheet-content")
    expect(archive).to_have_attribute(
        "data-evidence-archive-snapshot-revision", str(opened_archive_source["revision"])
    )
    archive_freshness = archive.locator(
        '[data-evidence-archive-snapshot-freshness="refresh-required"]'
    )
    expect(archive_freshness).to_be_visible()
    archive_failures = archive.locator(
        '[data-source-archive-failure-ledger="true"]'
    )
    expect(archive_failures).to_be_visible()
    expect(archive_failures).to_have_attribute("data-source-archive-failure-total", str(projection["total"]))
    expect(archive_failures).to_have_attribute("data-source-archive-failure-complete", "false")
    expect(archive_failures).to_have_attribute("data-source-archive-failure-scope", "partial")
    expect(archive_failures).to_have_attribute("data-source-archive-failure-unseen-event-count", str(projection["unseenEventCount"]))
    after_archive_open = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        before_archive, after_archive_open,
        "Opening the full failure ledger from its pinned partial Moonshot snapshot"
    )
    refresh_archive = archive.locator('[data-evidence-archive-refresh="true"]')
    expect(refresh_archive).to_be_visible()
    refresh_archive.tap()
    expect(archive).to_have_attribute(
        "data-evidence-archive-snapshot-revision", str(after_second_append["revision"])
    )
    expect(archive.locator('[data-evidence-archive-snapshot-freshness]')).to_have_count(0)
    after_archive_refresh = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        after_archive_open, after_archive_refresh,
        "Explicitly refreshing the pinned Evidence Archive"
    )
    page.locator("#sheet-close").tap()

    enter_nearby_institution(page, "moonshot_field", "Moonshot Field", "Moonshot Field")
    opened_source_observatory = authoritative_snapshot(page)
    after_third_append = append_witness_moonshot_revision(page, width, "source")
    latest_card = page.locator(
        '#sheet-content [data-moonshot-source-archive-failure-card="true"]' +
        '[data-moonshot-source-archive-failure-event-id="' + failure_event_id + '"]'
    )
    expect(latest_card).to_have_count(1)
    investigate = latest_card.locator(
        '[data-moonshot-source-archive-failure-investigate-event-id="' + failure_event_id + '"]'
    )
    expect(investigate).to_be_visible()
    before_investigation = authoritative_snapshot(page)
    investigate.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Source Observatory' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    source_observatory = page.locator("#sheet-content")
    expect(source_observatory).to_have_attribute(
        "data-source-observatory-snapshot-revision",
        str(opened_source_observatory["revision"])
    )
    expect(source_observatory).to_have_attribute(
        "data-source-observatory-snapshot-freshness", "refresh-required"
    )
    expect(source_observatory).to_have_attribute("data-source-observatory-snapshot-complete", "false")
    expect(source_observatory).to_have_attribute(
        "data-source-observatory-snapshot-unseen-event-count", str(projection["unseenEventCount"])
    )
    expect(source_observatory.locator(
        '[data-source-observatory-snapshot-notice="true"]'
    )).to_be_visible()
    record_lead = source_observatory.locator(
        '[data-source-observatory-record-lead]'
    )
    expect(record_lead).to_be_visible()
    record_lead.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Record a source observation' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    observation_form = page.locator(
        '#sheet-content [data-source-observation-form="true"]'
    )
    expect(observation_form).to_be_visible()
    expect(observation_form).to_have_attribute(
        "data-source-snapshot-revision", str(opened_source_observatory["revision"])
    )
    expect(observation_form).to_have_attribute(
        "data-source-observation-prefill-origin", "source-archive-failure"
    )
    expect(observation_form).to_have_attribute("data-source-snapshot-complete", "false")
    expect(observation_form).to_have_attribute(
        "data-source-snapshot-unseen-event-count", str(projection["unseenEventCount"])
    )
    after_investigation = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        before_investigation, after_investigation,
        "Opening a snapshot-bound failure lead without submitting it"
    )
    layout = assert_mobile_layout(page, width)
    page.screenshot(
        path=str(out / ("witness-moonshot-partial-snapshot-" + str(width) + ".png")),
        full_page=True
    )
    page.locator("#sheet-close").tap()
    return {
        "partialSnapshot": True,
        "unseenEventCount": projection["unseenEventCount"],
        "visibleFailureTotal": projection["total"],
        "partialScopeDisclosed": True,
        "chroniclePinnedRevision": opened["revision"],
        "chronicleRefreshedRevision": after_first_append["revision"],
        "evidenceArchivePinnedRevision": opened_archive_source["revision"],
        "evidenceArchiveRefreshedRevision": after_second_append["revision"],
        "sourceObservatoryPinnedRevision": opened_source_observatory["revision"],
        "sourceObservationFormSnapshotRevision": opened_source_observatory["revision"],
        "failureLeadNotSubmitted": True,
        "routeDiscoveries": route_discoveries,
        "layout": layout
    }


def inspect_witness_scope(page, founder_id, response_event_id, source_observation_event_id, source_archive_failure_event_id, after_archive, width, out):
    page.locator("#sheet-close").tap()
    witness = logout_to_witness(page)
    assert witness["id"] != founder_id
    before_board = authoritative_snapshot(page)
    assert before_board["viewer"]["role"] == "witness"
    assert source_observation_event_id in before_board["eventIds"], (
        "The Witness must see the retained Founder source-observation event in shared history."
    )
    assert source_archive_failure_event_id in before_board["eventIds"], (
        "The Witness must see the server-observed Source Archive failure in shared history."
    )
    witness_failure_projection = page.evaluate("""async expectedEventId => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Witness failure projection read failed: ' + response.status);
      const dto = await response.json();
      const { projectSourceArchiveFailureObjects } = await import('/world-view.mjs');
      const projection = projectSourceArchiveFailureObjects(dto.world);
      if (!projection) return null;
      return {
        complete: projection.complete,
        unseenEventCount: projection.unseenEventCount,
        eventIds: projection.records.map(record => record.eventId)
      };
    }""", source_archive_failure_event_id)
    assert witness_failure_projection is not None
    assert source_archive_failure_event_id in witness_failure_projection["eventIds"], (
        "The bounded Witness projection must preserve the visible service failure object."
    )
    assert response_event_id in before_board["eventIds"], (
        "The Witness must see the retained Founder response in shared world history."
    )
    rejected_event = find_event(
        after_archive,
        "collaborator-response-recorded",
        role="synthesizer",
        validationStatus="rejected"
    )
    assert rejected_event is not None
    assert rejected_event["actorId"] == founder_id
    assert rejected_event["id"] in before_board["eventIds"], (
        "The Witness must see the rejected Founder attempt in shared history."
    )
    after_arrival = open_quest_board(page)
    travel_discoveries = assert_route_travel_records_only_discoveries(
        before_board, after_arrival, "Walking to the Witness Quest Board"
    )
    founder_rows = page.locator('#sheet-content [data-objective-id^="founder-"]')
    expect(founder_rows).to_have_count(0)
    witness_row = page.locator('#sheet-content [data-objective-id="witness-multi-source-synthesis"]')
    expect(witness_row).to_have_count(1)
    expect(witness_row.locator(".quest-step-state")).to_have_text("OPEN")
    expect(witness_row).to_contain_text("0/1")
    witness_source_row = page.locator('#sheet-content [data-objective-id="witness-source-observation"]')
    expect(witness_source_row).to_have_count(1)
    expect(witness_source_row.locator(".quest-step-state")).to_have_text("OPEN")
    expect(witness_source_row).to_contain_text("0/1")
    after_board = authoritative_snapshot(page)
    assert_canonical_state_unchanged(after_arrival, after_board, "Reading the Witness Quest Board")
    page.screenshot(path=str(out / ("synthesis-witness-quest-" + str(width) + ".png")), full_page=True)

    page.locator("#sheet-close").tap()
    page.locator("#character-button").tap()
    expect(page.locator("#sheet-title")).to_have_text("Character & field record")
    skill_heading = page.get_by_role("heading", name="Synthesis", exact=True)
    expect(skill_heading).to_have_count(1)
    skill_card = skill_heading.locator("xpath=..")
    expect(skill_card).to_contain_text("0 recorded multi-source Synthesis Clerk attempts")
    after_character = authoritative_snapshot(page)
    assert_canonical_state_unchanged(after_board, after_character, "Reading the Witness character record")

    page.locator("#sheet-close").tap()
    moonshot_failure_history = inspect_witness_moonshot_failure_history(
        page, source_archive_failure_event_id, width, out
    )
    witness_packet = project_synthesis_packet(page)
    assert witness_packet["available"] is True
    witness_card, after_npc = open_synthesis_clerk(page, witness_packet)
    witness_attempts = witness_card.locator('[data-retained-collaborator-response="true"]')
    expect(witness_attempts).to_have_count(0)
    assert response_event_id in after_npc["eventIds"]
    assert rejected_event["id"] in after_npc["eventIds"]
    page.screenshot(path=str(out / ("synthesis-witness-npc-" + str(width) + ".png")), full_page=True)

    return {
        "witnessId": witness["id"],
        "founderObjectiveHidden": True,
        "witnessObjectiveStatus": "OPEN",
        "witnessObjectiveProgress": "0/1",
        "founderSourceObservationVisibleInSharedHistory": True,
        "sourceArchiveFailureVisibleInSharedHistory": True,
        "sourceArchiveFailureProjectionComplete": witness_failure_projection["complete"],
        "sourceArchiveFailureProjectionUnseenEventCount": witness_failure_projection["unseenEventCount"],
        "witnessSourceObservationStatus": "OPEN",
        "witnessSourceObservationProgress": "0/1",
        "witnessSynthesisSkillCount": 0,
        "founderResponseVisibleInSharedHistory": True,
        "founderRejectedAttemptVisibleInSharedHistory": True,
        "witnessNpcRetainedAttemptCount": 0,
        "moonshotFailureHistory": moonshot_failure_history,
        "npcRouteDiscoveries": after_npc["npcRouteDiscoveries"],
        "worldSurface": after_npc["worldSurface"],
        "routeDiscoveries": travel_discoveries
    }


def assert_mobile_layout(page, width):
    layout = page.evaluate("""() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      sheetWidth: document.querySelector('#sheet')?.clientWidth ?? 0
    })""")
    assert layout["viewportWidth"] == width, layout
    assert layout["documentWidth"] <= layout["viewportWidth"] + 1, (
        "Synthesis Clerk journey caused horizontal overflow: " + json.dumps(layout)
    )
    return layout




def assert_offline_cached_shared_snapshot_recovery(page, width):
    # A reload while offline may reopen only a redacted public snapshot.
    wait_for_shared_connection(page, "before cached shared-snapshot re-entry")
    if page.locator("#sheet").is_visible():
        page.locator("#sheet-close").tap()
    before = wait_for_stable_world_snapshot(page)
    server_before = authoritative_position(page)
    viewer_before = page.evaluate("""async () => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Shared identity read failed: ' + response.status);
      const dto = await response.json();
      return { id: dto.viewer.id, role: dto.viewer.role };
    }""")
    viewer_before = page.evaluate("""async () => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Shared identity read failed: ' + response.status);
      const dto = await response.json();
      return { id: dto.viewer.id, role: dto.viewer.role };
    }""")
    page.wait_for_function(
        "() => Boolean(navigator.serviceWorker?.controller)",
        timeout=20000
    )
    cached_before = page.evaluate("""() => {
      const raw = localStorage.getItem('ngl.common-ground.shared-snapshot.v1');
      if (!raw) return null;
      const envelope = JSON.parse(raw);
      return { revision: envelope.world?.revision, actorId: envelope.viewer?.id,
        actorRole: envelope.viewer?.role, scope: envelope.scope };
    }""")
    assert cached_before is not None, "Accepted shared state must be cached before offline reload."
    assert cached_before["revision"] == before["revision"]
    assert cached_before["actorId"] == viewer_before["id"]
    assert cached_before["actorRole"] == viewer_before["role"]
    assert cached_before["scope"] == "public-witness-projection"

    write_attempts = []
    def capture_write(request):
        if request.method == "POST" and "/api/" in request.url:
            write_attempts.append({"method": request.method, "url": request.url})
    page.on("request", capture_write)
    page.context.set_offline(True)
    page.reload(wait_until="domcontentloaded")
    page.locator("#start-shared").wait_for(state="visible")
    page.locator("#start-shared").tap()
    page.locator("#world").wait_for(state="visible")
    page.wait_for_function("""() => {
      const world = document.querySelector('#world');
      const label = document.querySelector('#mode-label')?.textContent || '';
      const dot = document.querySelector('#connection-dot');
      return world?.dataset.sharedSnapshotCacheOnly === 'true' &&
        world?.dataset.sharedSnapshotSource === 'local-cache' &&
        world?.dataset.sharedOfflinePreview === 'true' &&
        world?.dataset.movementEnabled === 'true' &&
        dot?.dataset.connectionState === 'offline' &&
        label.includes('read-only');
    }""", timeout=20000)

    cached = page.evaluate("""() => {
      const envelope = JSON.parse(localStorage.getItem('ngl.common-ground.shared-snapshot.v1'));
      const position = JSON.parse(localStorage.getItem('ngl.common-ground.shared-position.v1') || 'null');
      return {
        revision: envelope.world.revision,
        actorId: envelope.viewer.id,
        actorRole: envelope.viewer.role,
        drafts: envelope.world.drafts.length,
        privateEvents: envelope.world.events.filter(event =>
          ['draft', 'repair', 'message-reported'].includes(event.type)).length,
        hasPresence: Object.hasOwn(envelope, 'presence'),
        hasInstitution: Object.hasOwn(envelope, 'institution'),
        hasSourceSnapshotReceipt: Object.hasOwn(envelope, 'sourceSnapshotReceipt'),
        positionMatches: Boolean(position &&
          position.actorId === envelope.viewer.id &&
          position.actorRole === envelope.viewer.role &&
          position.worldRevision === envelope.world.revision)
      };
    }""")
    assert cached["revision"] == before["revision"]
    assert cached["actorId"] == viewer_before["id"]
    assert cached["actorRole"] == viewer_before["role"]
    assert cached["drafts"] == 0
    assert cached["privateEvents"] == 0
    assert not cached["hasPresence"]
    assert not cached["hasInstitution"]
    assert not cached["hasSourceSnapshotReceipt"]
    assert cached["positionMatches"]
    expect(page.locator("#login-button")).to_be_visible()
    expect(page.locator("#logout-button")).to_be_hidden()
    expect(page.locator("#make-button")).to_contain_text("Read-only snapshot")

    # Exercise the normal draft control. It must fail before a POST or pending
    # action receipt is created; cached display is not permission to mutate.
    page.locator("#make-button").tap()
    page.locator("#command-input").fill("Offline cached snapshot write attempt " + str(width))
    page.locator("#intent-input").fill(
        "This draft must remain unsubmitted until a fresh server state is accepted."
    )
    page.locator("#draft-button").tap()
    page.wait_for_function(
        "() => document.querySelector('#toast')?.textContent.includes('cached shared snapshot')",
        timeout=10000
    )
    assert write_attempts == [], "Cached-only mode must block POSTs before network submission."
    if page.locator("#sheet").is_visible():
        page.locator("#sheet-close").tap()

    page.context.set_offline(False)
    page.evaluate("() => window.dispatchEvent(new Event('online'))")
    wait_for_shared_connection(page, "after cached shared-snapshot revalidation")
    page.wait_for_function("""() => {
      const world = document.querySelector('#world');
      return world?.dataset.sharedSnapshotCacheOnly === 'false' &&
        world?.dataset.sharedSnapshotSource === 'server' &&
        world?.dataset.sharedOfflinePreview === 'false';
    }""", timeout=20000)
    after = authoritative_snapshot(page)
    assert_canonical_state_unchanged(before, after, "Offline cached shared-snapshot re-entry")
    assert authoritative_position(page) == server_before, (
        "Fresh server revalidation must restore the accepted position, not cached local preview."
    )
    assert write_attempts == [], "Cached inspection must not submit shared writes."
    assert_mobile_layout(page, width)
    return {
        "transport": "synthetic browser offline reload and online revalidation",
        "cachedRevision": cached["revision"],
        "cachedScope": "public-witness-projection",
        "identityReauthenticated": False,
        "writesAttempted": write_attempts,
        "sharedPositionBefore": server_before,
        "sharedPositionAfter": authoritative_position(page),
        "canonicalStateUnchanged": True,
        "revalidatedToServer": True
    }


def assert_private_import_shared_reentry(page, width, out):
    # Importing while offline cache-only must create a real private boundary,
    # not leave the cached shared-session affordances attached to the private world.
    wait_for_shared_connection(page, "before private-import export")
    if page.locator("#sheet").is_visible():
        page.locator("#sheet-close").tap()
    shared_before = authoritative_snapshot(page)
    exported_world = page.evaluate("""async () => {
      const response = await fetch('/api/export', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared export failed: ' + response.status);
      const payload = await response.json();
      const world = payload && payload.world ? payload.world : payload;
      if (!world || typeof world.id !== 'string' || !Number.isSafeInteger(world.revision)) {
        throw new Error('Shared export omitted world identity or revision.');
      }
      return world;
    }""")
    assert exported_world["revision"] == shared_before["revision"], (
        "The export and authoritative shared snapshot must identify the same revision."
    )

    private_fixture = page.evaluate("""async exportedWorld => {
      const { validateWorld, applyAction } = await import('/model.mjs');
      const base = await validateWorld(exportedWorld);
      const actorId = crypto.randomUUID();
      localStorage.setItem('ngl.common-ground.v2.actor', actorId);
      const actor = { id: actorId, name: 'Damien', role: 'founder' };
      const result = await applyAction(
        base,
        { type: 'discover', locationId: 'river' },
        actor
      );
      const privateWorld = result?.world;
      if (!privateWorld || privateWorld.id !== base.id ||
          !Number.isSafeInteger(privateWorld.revision) ||
          privateWorld.revision <= base.revision) {
        throw new Error('Private fixture did not advance the same world identity.');
      }
      const privateEvent = privateWorld.events.at(-1);
      if (!privateEvent?.id) throw new Error('Private fixture did not retain its discovery event.');
      return {
        save: {
          schema: 'ngl.private-save.v1',
          world: privateWorld,
          playerPosition: { x: 180, y: 640 }
        },
        meta: {
          worldId: base.id,
          baseRevision: base.revision,
          privateRevision: privateWorld.revision,
          privateEventId: privateEvent.id,
          baseXp: base.xp,
          privateXp: privateWorld.xp
        }
      };
    }""", exported_world)
    meta = private_fixture["meta"]
    assert meta["worldId"] == exported_world["id"]
    assert meta["baseRevision"] == shared_before["revision"]
    assert meta["privateRevision"] > meta["baseRevision"]
    assert meta["privateXp"] == meta["baseXp"], (
        "A private discovery is not a publication or a source-truth reward."
    )
    assert meta["privateEventId"] not in shared_before["eventIds"]

    page.wait_for_function(
        "() => Boolean(navigator.serviceWorker?.controller)",
        timeout=20000
    )
    page.context.set_offline(True)
    page.reload(wait_until="domcontentloaded")
    page.locator("#start-shared").wait_for(state="visible")
    page.locator("#start-shared").tap()
    page.locator("#world").wait_for(state="visible")
    page.wait_for_function("""() => {
      const world = document.querySelector('#world');
      const dot = document.querySelector('#connection-dot');
      return world?.dataset.sharedSnapshotCacheOnly === 'true' &&
        world?.dataset.sharedSnapshotSource === 'local-cache' &&
        world?.dataset.sharedOfflinePreview === 'true' &&
        dot?.dataset.connectionState === 'offline';
    }""", timeout=20000)
    cached_revision = page.locator("#world").get_attribute("data-shared-snapshot-revision")
    assert cached_revision == str(meta["baseRevision"])

    page.locator("#journal-button").tap()
    page.locator("#import-world").wait_for(state="attached")
    write_attempts = []

    def capture_write(request):
        if request.method == "POST" and "/api/" in request.url:
            write_attempts.append({"method": request.method, "url": request.url})

    page.on("request", capture_write)
    private_save_bytes = json.dumps(
        private_fixture["save"], separators=(",", ":")
    ).encode("utf-8")
    page.locator("#import-world").set_input_files({
        "name": "ngl-private-import-regression.json",
        "mimeType": "application/json",
        "buffer": private_save_bytes
    })
    page.wait_for_function("""() => {
      const mode = document.querySelector('#mode-label')?.textContent || '';
      return mode.includes('Private world') &&
        document.querySelector('#sheet')?.hidden === true;
    }""", timeout=20000)

    imported = page.evaluate("""() => {
      const raw = localStorage.getItem('ngl.common-ground.v2');
      const world = raw ? JSON.parse(raw) : null;
      const canvas = document.querySelector('#world');
      const dot = document.querySelector('#connection-dot');
      return {
        worldId: world?.id,
        revision: world?.revision,
        xp: world?.xp,
        modeLabel: document.querySelector('#mode-label')?.textContent || '',
        sharedSnapshotSource: canvas?.dataset.sharedSnapshotSource,
        sharedSnapshotCacheOnly: canvas?.dataset.sharedSnapshotCacheOnly,
        sharedOfflinePreview: canvas?.dataset.sharedOfflinePreview,
        sharedSnapshotRevision: canvas?.dataset.sharedSnapshotRevision,
        worldRevision: canvas?.dataset.worldRevision,
        movementEnabled: canvas?.dataset.movementEnabled,
        connectionState: dot?.dataset.connectionState,
        connectionTitle: dot?.title || '',
        makeButton: document.querySelector('#make-button')?.textContent || ''
      };
    }""")
    # The private event ID is checked separately from the stored event array;
    # it is not exposed on window or accepted as canonical state.
    imported_event_ids = page.evaluate("""() => {
      const world = JSON.parse(localStorage.getItem('ngl.common-ground.v2'));
      return Array.isArray(world?.events) ? world.events.map(event => event.id) : [];
    }""")
    assert imported["worldId"] == meta["worldId"]
    assert imported["revision"] == meta["privateRevision"]
    assert imported["xp"] == meta["privateXp"]
    assert meta["privateEventId"] in imported_event_ids
    assert imported["modeLabel"].startswith("Private world")
    assert imported["sharedSnapshotSource"] == "private", imported
    assert imported["sharedSnapshotCacheOnly"] == "false", imported
    assert imported["sharedOfflinePreview"] == "false", imported
    assert imported["sharedSnapshotRevision"] == str(meta["privateRevision"]), imported
    assert imported["worldRevision"] == str(meta["privateRevision"]), imported
    assert imported["movementEnabled"] == "true", imported
    assert imported["connectionState"] == "offline", imported
    assert "private work remains on this device" in imported["connectionTitle"], imported
    assert "Read-only snapshot" not in imported["makeButton"], imported
    assert write_attempts == [], (
        "Importing a private save while cache-only must not submit a shared write."
    )
    page.screenshot(
        path=str(out / ("private-import-offline-" + str(width) + ".png")),
        full_page=True
    )

    page.context.set_offline(False)
    page.evaluate("() => window.dispatchEvent(new Event('online'))")
    wait_for_shared_connection(page, "after private import network restoration")
    page.locator("#journal-button").tap()
    enter_shared = page.locator("#sheet-content button").filter(has_text="Enter shared world")
    expect(enter_shared).to_be_visible()
    enter_shared.tap()
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')",
        timeout=20000
    )
    wait_for_shared_connection(page, "after private-import shared re-entry")

    after = authoritative_snapshot(page)
    assert_canonical_state_unchanged(
        shared_before, after, "Private-import shared-snapshot re-entry"
    )
    assert after["revision"] == meta["baseRevision"]
    assert after["revision"] < meta["privateRevision"]
    assert meta["privateEventId"] not in after["eventIds"], (
        "The imported private discovery must never enter shared history."
    )
    live = page.evaluate("""() => {
      const canvas = document.querySelector('#world');
      return {
        source: canvas?.dataset.sharedSnapshotSource,
        cacheOnly: canvas?.dataset.sharedSnapshotCacheOnly,
        offlinePreview: canvas?.dataset.sharedOfflinePreview,
        sharedRevision: canvas?.dataset.sharedSnapshotRevision,
        worldRevision: canvas?.dataset.worldRevision,
        modeLabel: document.querySelector('#mode-label')?.textContent || '',
        makeButton: document.querySelector('#make-button')?.textContent || ''
      };
    }""")
    assert live["source"] == "server", live
    assert live["cacheOnly"] == "false", live
    assert live["offlinePreview"] == "false", live
    assert live["sharedRevision"] == str(after["revision"]), live
    assert live["worldRevision"] == str(after["revision"]), live
    assert live["modeLabel"].startswith("Shared world"), live
    assert "Read-only snapshot" not in live["makeButton"], live
    assert write_attempts == [], (
        "Private import and shared re-entry must not manufacture a shared mutation."
    )
    assert_mobile_layout(page, width)
    return {
        "transport": "synthetic browser offline cache-only import and live re-entry",
        "worldId": meta["worldId"],
        "sharedRevisionBefore": meta["baseRevision"],
        "privateRevision": meta["privateRevision"],
        "sharedRevisionAfter": after["revision"],
        "privateEventId": meta["privateEventId"],
        "privateEventNotShared": True,
        "privateModeFlagsReset": True,
        "firstLowerRevisionServerSnapshotAccepted": True,
        "canonicalSharedStateUnchanged": True,
        "sharedWritesAttempted": write_attempts
    }


def run_viewport(browser, width, out):
    context = browser.new_context(
        viewport={"width": width, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True
    )
    page = context.new_page()
    page.set_default_timeout(15000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    server_process = None
    try:
        with tempfile.TemporaryDirectory(prefix="ngl-synthesis-clerk-") as data_dir:
            server_process, url = launch_server(data_dir)
            try:
                page.goto(url, wait_until="networkidle")
                start_shared(page)
                founder = login_founder(page)
                observatory = seed_source_observatory(page, width)
                source_archive_failure = seed_source_archive_failure(page, width)
                failure_ledger = inspect_source_archive_failure_ledger(
                    page, source_archive_failure, width, out
                )
                moonshot_failure_history = inspect_moonshot_source_archive_failures(
                    page, source_archive_failure, width, out
                )

                fixture = seed_proposal_and_report(page, width)
                witness = add_witness_challenge(page, width, fixture)
                founder_state = return_to_founder(page, founder["id"])
                assert founder_state["viewer"]["role"] == "founder"
                assert founder_state["xp"] == fixture["baselineXp"]

                card, before_open = open_synthesis_clerk(page, witness["packet"])
                offline_preview = assert_offline_preview_keeps_local_route(page, "Synthesis Clerk")
                assert before_open["viewer"]["id"] == founder["id"]
                snapshot = page.locator('#sheet-content [data-project-state-snapshot="true"]')
                project_state_snapshot = {
                    "status": snapshot.get_attribute("data-project-state-status"),
                    "capturedAt": snapshot.get_attribute("data-project-state-captured-at"),
                    "buildSha": snapshot.get_attribute("data-project-state-build-sha"),
                    "receiptDigest": snapshot.get_attribute("data-project-state-receipt-digest"),
                    "connectionState": page.locator("#connection-dot").get_attribute("data-connection-state"),
                    "modeLabel": page.locator("#mode-label").text_content()
                }
                snapshot.scroll_into_view_if_needed()
                pull_group = snapshot.locator('[data-project-state-source="pullRequests"]')
                pull_records = pull_group.locator("li")
                captured_pull_requests = pull_records.count()
                assert project_state_snapshot["connectionState"] == "online"
                assert "reconnecting" not in (project_state_snapshot["modeLabel"] or "")
                project_state_snapshot["capturedPullRequests"] = captured_pull_requests
                project_state_snapshot["pullRequestExpansionVerified"] = False
                if captured_pull_requests > 8:
                    expand = pull_group.locator('[data-project-state-expand="pullRequests"]')
                    expect(expand).to_be_visible()
                    expect(expand).to_have_attribute("aria-expanded", "false")
                    expect(pull_group.locator("li:visible")).to_have_count(8)
                    list_id = pull_records.locator("xpath=..").get_attribute("id")
                    assert expand.get_attribute("aria-controls") == list_id

                    before_expand = authoritative_snapshot(page)
                    expand.tap()
                    expect(expand).to_have_attribute("aria-expanded", "true")
                    expect(pull_group.locator("li:visible")).to_have_count(captured_pull_requests)
                    expect(expand).to_have_text("Show newest 8 only")
                    expect(pull_records.nth(8)).to_be_visible()
                    expect(pull_records.nth(8).locator(
                        '[data-project-state-record-lead="pullRequests"]'
                    )).to_be_visible()
                    after_expand = authoritative_snapshot(page)
                    assert_canonical_state_unchanged(
                        before_expand, after_expand,
                        "Expanding all captured Synthesis Clerk pull requests"
                    )

                    expand.tap()
                    expect(expand).to_have_attribute("aria-expanded", "false")
                    expect(pull_group.locator("li:visible")).to_have_count(8)
                    after_collapse = authoritative_snapshot(page)
                    assert_canonical_state_unchanged(
                        before_expand, after_collapse,
                        "Collapsing captured Synthesis Clerk pull requests"
                    )
                    project_state_snapshot["pullRequestExpansionVerified"] = True

                page.screenshot(
                    path=str(out / ("synthesis-clerk-project-state-" + str(width) + ".png")),
                    full_page=True
                )
                source_observation, after_source_observation = record_project_state_lead(
                    page, founder["id"], observatory
                )
                page.locator("#sheet-close").tap()
                refreshed_packet = project_synthesis_packet(page)
                assert refreshed_packet["available"] is True, refreshed_packet["reason"]
                assert refreshed_packet["inputRefs"] == witness["packet"]["inputRefs"], (
                    "The unrelated source-observation event must not rewrite the Synthesis Clerk's exact input references."
                )
                witness["packet"] = refreshed_packet
                witness["packetPayload"] = json.loads(refreshed_packet["packetJson"])
                card, before_open = open_synthesis_clerk(page, witness["packet"])
                assert before_open["viewer"]["id"] == founder["id"]
                response, after_archive = validate_and_archive(
                    page,
                    card,
                    witness["packet"],
                    witness["packetPayload"],
                    fixture["reportEventId"],
                    founder["id"],
                    width,
                    out
                )
                founder_progress = inspect_founder_progress(
                    page, after_archive, source_observation["eventId"], width, out
                )
                witness_progress = inspect_witness_scope(
                    page,
                    founder["id"],
                    response["responseEventId"],
                    source_observation["eventId"],
                    source_archive_failure["eventId"],
                    after_archive,
                    width,
                    out
                )
                return_to_founder(page, founder["id"])
                offline_snapshot_reentry = assert_offline_cached_shared_snapshot_recovery(page, width)
                private_import_reentry = assert_private_import_shared_reentry(page, width, out)
                layout = assert_mobile_layout(page, width)
                assert not errors, "Browser page errors: " + json.dumps(errors)

                result = {
                    "journey": "touch-synthesis-clerk-" + str(width),
                    "passed": True,
                    "viewport": width,
                    "founderId": founder["id"],
                    "witnessId": witness["witnessId"],
                    "moonshotId": fixture["moonshotId"],
                    "proposalEventId": fixture["proposalEventId"],
                    "reportEventId": fixture["reportEventId"],
                    "challengeEventId": witness["challengeEventId"],
                    "packetInputRefs": witness["packet"]["inputRefs"],
                    "packetAuthority": witness["packetPayload"]["authority"],
                    "packetSourceSnapshotStatus": witness["packetPayload"]["sourceSnapshot"]["status"],
                    "proposalOnlyPacketUnavailable": True,
                    "synthesisNpcVisitedAndOpened": True,
                    "projectStateSnapshot": project_state_snapshot,
                    "offlinePreview": offline_preview,
                    "offlineSnapshotReentry": offline_snapshot_reentry,
                    "privateImportReentry": private_import_reentry,
                    "sourceObservatory": observatory,
                    "sourceArchiveFailure": source_archive_failure,
                    "sourceArchiveFailureLedger": failure_ledger,
                    "moonshotSourceArchiveFailures": moonshot_failure_history,
                    "sourceObservation": source_observation,
                    "response": response,
                    "founderProgress": founder_progress,
                    "witnessProgress": witness_progress,
                    "worldRevision": after_archive["revision"],
                    "worldXp": after_archive["xp"],
                    "layout": layout,
                    "pageErrors": errors
                }
                (out / ("synthesis-clerk-" + str(width) + ".json")).write_text(
                    json.dumps(result, indent=2) + "\n",
                    encoding="utf-8"
                )
                return result
            finally:
                stop_server(server_process)
                server_process = None
    except Exception:
        try:
            page.screenshot(
                path=str(out / ("synthesis-clerk-" + str(width) + "-failure.png")),
                full_page=True
            )
        except Exception:
            pass
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("artifacts/synthesis-clerk-mobile"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            results = [run_viewport(browser, width, args.out) for width in (320, 390)]
        finally:
            browser.close()

    summary = {
        "journeys": results,
        "passed": len(results) == 2 and all(result["passed"] for result in results),
        "evidenceBoundary": "The disposable shared-server fixture injects 13 initial 503 GitHub responses and a 14th while the Founder is viewing the older failure page. The service appends 14 Founder-attributed source-archive-attempt-failed events, each bound to a distinct request ID; no client-authored failure, draft, publication, XP, truth verdict, or authority is created. The Evidence Archive renders bounded pages of 12, and its local cursor resets to the newest page when the shared world revision changes. The acceptance compares page revision against the post-arrival snapshot so legitimate location discovery remains retained. Pagination and cursor rebinding create no canonical event or XP. The Witness can see the latest failure in shared history. These are simulated upstream outages, not live GitHub outages. The fixture also explicitly publishes one Source Observatory (the existing publication action contributes 100 WORLD XP). The Synthesis Clerk's build-time GitHub snapshot can be carried into the Source Observatory only as a prefilled lead. Explicit submission creates one actor- and exact-version-bound source-observation event with retrieval and independent verification NOT_PERFORMED, model assertions LEADS_ONLY, execution NOT_EXECUTED, and zero XP. The Founder quest records that event; the Witness sees it but receives no Founder progress. The collaborator response remains untrusted, and the Relay retry remains exact-request/idempotent. The offline shared-snapshot re-entry journey reloads a redacted public projection under synthetic browser offline conditions, blocks shared writes and resumes only after fresh server state is accepted. A separate private-import journey imports a same-world save whose local revision is higher while the client is in cache-only mode, verifies private provenance/controls reset, then re-enters the live server at its lower accepted revision without leaking the private event or changing shared history. Both connectivity transitions are synthetic browser events, not physical network or Android-device tests; no truth, execution, approval, mastery, or authority is established."
    }
    (args.out / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))
    if not summary["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
