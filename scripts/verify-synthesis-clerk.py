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
import json
import select
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FOUNDER_KEY = "fake-browser-fixture-key-not-a-secret"
SERVER = """import {createGameServer} from './game/server.mjs';
const server=await createGameServer({
  dataDir:process.argv[1],
  founderKey:'fake-browser-fixture-key-not-a-secret'
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


def start_shared(page):
    page.locator("#start-shared").tap()
    page.locator("#world").wait_for(state="visible")
    expect(page.locator("#world")).to_have_attribute("data-world-renderer", "pixel-v1")
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
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
        assert event.get("locationId") in {"relay", "river", "overlook", "ruins"}, label + " recorded an unknown guide location."
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
    assert len(after_challenge["eventIds"]) == len(fixture["afterReport"]["eventIds"]) + 1
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


def open_synthesis_clerk(page, packet):
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
        target = page.evaluate("""async () => {
          const { GUILD_NPCS, projectGuildNpcPointerTarget } = await import('/pixel-world-view.mjs');
          const npc = GUILD_NPCS.find(candidate => candidate.roleId === 'synthesizer');
          const canvas = document.querySelector('#world');
          if (!npc || !canvas) throw new Error('Synthesis Clerk sprite or world canvas is missing.');
          const rect = canvas.getBoundingClientRect();
          // The NPC route terminates at (npc.x, npc.y + 12). Shared-world player
          // positions are intentionally not persisted in private local storage.
          const player = { x: npc.x, y: npc.y + 12 };
          const zoom = rect.width < 600 ? 0.78 : Math.max(0.64, Math.min(0.92, rect.width / 1500));
          const visibleWidth = rect.width / zoom;
          const visibleHeight = rect.height / zoom;
          const camera = {
            x: Math.max(visibleWidth / 2, Math.min(1600 - visibleWidth / 2, player.x + 100)),
            y: Math.max(visibleHeight / 2, Math.min(1000 - visibleHeight / 2, player.y - 50))
          };
          const point = {
            x: rect.width / 2 + (npc.x - camera.x) * zoom,
            y: rect.height / 2 + (npc.y + 10 - camera.y) * zoom
          };
          const selected = projectGuildNpcPointerTarget(point, camera, zoom, rect.width, rect.height);
          return { point, selected, player, camera, zoom, width: rect.width, height: rect.height };
        }""")
        assert target["selected"] and target["selected"]["roleId"] == "synthesizer", (
            "The computed touch point must resolve to the actual Synthesis Clerk NPC: " +
            json.dumps(target)
        )
        page.locator("#world").tap(position=target["point"])
        page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Guild Hall' && " +
            "!document.querySelector('#sheet').hidden",
            timeout=30000
        )
    
    card = page.locator('#sheet-content [data-collaborator-role="synthesizer"]')
    expect(card).to_have_count(1)
    expect(card).to_contain_text("Synthesis Clerk")
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
    assert_canonical_state_unchanged(before, after, "Walking to and directly tapping the Synthesis Clerk")
    return card, after

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
    card, after_reopen = open_synthesis_clerk(page, packet)
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
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to Quest Board", exact=True)
    expect(route).to_be_visible()
    route.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Quest Board' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    return wait_for_stable_world_snapshot(page)


def inspect_founder_progress(page, after_archive, width, out):
    after_arrival = open_quest_board(page)
    travel_discoveries = assert_route_travel_records_only_discoveries(
        after_archive, after_arrival, "Walking to the Founder Quest Board"
    )
    row = page.locator('#sheet-content [data-objective-id="founder-multi-source-synthesis"]')
    expect(row).to_have_count(1)
    expect(row.locator(".quest-step-state")).to_have_text("RECORDED")
    expect(row).to_contain_text("1/1")
    after_board = authoritative_snapshot(page)
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
        "synthesisSkillCount": 2,
        "routeDiscoveries": travel_discoveries
    }


def inspect_witness_scope(page, founder_id, response_event_id, after_archive, width, out):
    page.locator("#sheet-close").tap()
    witness = logout_to_witness(page)
    assert witness["id"] != founder_id
    before_board = authoritative_snapshot(page)
    assert before_board["viewer"]["role"] == "witness"
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
    witness_packet = project_synthesis_packet(page)
    assert witness_packet["available"] is True
    before_npc = authoritative_snapshot(page)
    witness_card, after_npc = open_synthesis_clerk(page, witness_packet)
    witness_attempts = witness_card.locator('[data-retained-collaborator-response="true"]')
    expect(witness_attempts).to_have_count(0)
    assert response_event_id in after_npc["eventIds"]
    assert rejected_event["id"] in after_npc["eventIds"]
    assert_canonical_state_unchanged(
        before_npc, after_npc,
        "Opening the Synthesis Clerk as a different Witness"
    )
    page.screenshot(path=str(out / ("synthesis-witness-npc-" + str(width) + ".png")), full_page=True)

    return {
        "witnessId": witness["id"],
        "founderObjectiveHidden": True,
        "witnessObjectiveStatus": "OPEN",
        "witnessObjectiveProgress": "0/1",
        "witnessSynthesisSkillCount": 0,
        "founderResponseVisibleInSharedHistory": True,
        "founderRejectedAttemptVisibleInSharedHistory": True,
        "witnessNpcRetainedAttemptCount": 0,
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

                fixture = seed_proposal_and_report(page, width)
                witness = add_witness_challenge(page, width, fixture)
                founder_state = return_to_founder(page, founder["id"])
                assert founder_state["viewer"]["role"] == "founder"
                assert founder_state["xp"] == fixture["baselineXp"]

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
                founder_progress = inspect_founder_progress(page, after_archive, width, out)
                witness_progress = inspect_witness_scope(
                    page,
                    founder["id"],
                    response["responseEventId"],
                    after_archive,
                    width,
                    out
                )
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
        "evidenceBoundary": "A structurally valid and a deliberately rejected collaborator response are retained as actor-attributed untrusted attempts; the NPC rehydrates both without endorsement. A simulated post-commit 503 is recovered through The Relay using the exact actor-bound request receipt. This is not a physical network or Android-device test. No independent source observation, truth, execution, XP, approval, mastery, or authority is established."
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
