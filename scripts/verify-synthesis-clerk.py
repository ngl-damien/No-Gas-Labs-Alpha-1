"""Touch-browser acceptance for the in-world Synthesis Clerk.

A disposable shared world records a Founder proposal and failed attempt, a
separate Witness records a methodological challenge, and the Founder visits
the Synthesis Clerk NPC through the world route and Interact control. A
packet-bound response is validated and explicitly archived as untrusted
history. The journey checks actor-scoped quest/skill projections and verifies
that inspection/validation does not mutate canonical state or award XP.
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
        creationIds: world.creations.map(creation => creation.id),
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
    assert after["xp"] == before["xp"], label + " changed world XP."
    assert after["creationIds"] == before["creationIds"], label + " created or removed publications."


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
    page.locator("#interact-button").tap()
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
    assert_canonical_state_unchanged(before, after, "Walking to and opening the Synthesis Clerk")
    return card, after


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

    card.locator('[data-archive-collaborator="synthesizer"]').tap()
    archive_button = card.locator('[data-archive-collaborator="synthesizer"]')
    expect(archive_button).to_have_text("Response archived")
    expect(archive_button).to_be_disabled()
    expect(status).to_contain_text("ARCHIVED · STRUCTURE VALID FOR HUMAN REVIEW ONLY")
    expect(status).to_contain_text(
        "No claim, evidence, execution, approval, mastery, XP, or authority was verified."
    )
    expect(page.locator("#toast")).to_contain_text("no XP or authority awarded")

    after_archive = authoritative_snapshot(page)
    assert after_archive["revision"] == before_validation["revision"] + 1
    assert len(after_archive["eventIds"]) == len(before_validation["eventIds"]) + 1
    assert after_archive["xp"] == before_validation["xp"]
    assert after_archive["creationIds"] == before_validation["creationIds"]
    new_ids = set(after_archive["eventIds"]) - set(before_validation["eventIds"])
    assert len(new_ids) == 1
    response_event = find_event(
        after_archive, "collaborator-response-recorded", role="synthesizer"
    )
    assert response_event is not None
    assert response_event["id"] in new_ids
    assert response_event["actorId"] == founder_id
    assert response_event["actorRole"] == "founder"
    assert response_event["moonshotId"] == packet["moonshotId"]
    assert response_event["sourceEventIds"] == packet["inputRefs"]
    assert response_event["validationStatus"] == "valid-for-human-review"
    assert response_event["validator"] == "ngl.collaborator-response.v1"
    assert response_event["responseText"] == response_text
    page.screenshot(path=str(out / ("synthesis-clerk-" + str(width) + ".png")), full_page=True)
    return {
        "responseId": response_event["responseId"],
        "responseEventId": response_event["id"],
        "validationStatus": response_event["validationStatus"],
        "sourceEventIds": response_event["sourceEventIds"],
        "worldRevision": after_archive["revision"],
        "xp": after_archive["xp"],
        "retainedUntrustedResponse": True
    }, after_archive


def open_quest_board(page):
    page.locator("#sheet-close").tap()
    expect(page.locator("#sheet")).to_be_hidden()
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to Quest Board", exact=True)
    expect(route).to_be_visible()
    route.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Quest Board' && " +
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )


def inspect_founder_progress(page, after_archive, width, out):
    open_quest_board(page)
    row = page.locator('#sheet-content [data-objective-id="founder-multi-source-synthesis"]')
    expect(row).to_have_count(1)
    expect(row.locator(".quest-step-state")).to_have_text("RECORDED")
    expect(row).to_contain_text("1/1")
    after_board = authoritative_snapshot(page)
    assert_canonical_state_unchanged(after_archive, after_board, "Reading the Founder Quest Board")
    page.screenshot(path=str(out / ("synthesis-quest-board-" + str(width) + ".png")), full_page=True)

    page.locator("#sheet-close").tap()
    page.locator("#character-button").tap()
    expect(page.locator("#sheet-title")).to_have_text("Character & field record")
    skill_heading = page.get_by_role("heading", name="Synthesis", exact=True)
    expect(skill_heading).to_have_count(1)
    skill_card = skill_heading.locator("xpath=..")
    expect(skill_card).to_contain_text("1 recorded multi-source Synthesis Clerk attempts")
    after_character = authoritative_snapshot(page)
    assert_canonical_state_unchanged(after_archive, after_character, "Reading the Founder character record")
    page.screenshot(path=str(out / ("synthesis-character-" + str(width) + ".png")), full_page=True)
    return {
        "questObjective": "founder-multi-source-synthesis",
        "questStatus": "RECORDED",
        "questProgress": "1/1",
        "synthesisSkillCount": 1
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
    open_quest_board(page)
    founder_rows = page.locator('#sheet-content [data-objective-id^="founder-"]')
    expect(founder_rows).to_have_count(0)
    witness_row = page.locator('#sheet-content [data-objective-id="witness-multi-source-synthesis"]')
    expect(witness_row).to_have_count(1)
    expect(witness_row.locator(".quest-step-state")).to_have_text("OPEN")
    expect(witness_row).to_contain_text("0/1")
    after_board = authoritative_snapshot(page)
    assert_canonical_state_unchanged(before_board, after_board, "Reading the Witness Quest Board")
    page.screenshot(path=str(out / ("synthesis-witness-quest-" + str(width) + ".png")), full_page=True)

    page.locator("#sheet-close").tap()
    page.locator("#character-button").tap()
    expect(page.locator("#sheet-title")).to_have_text("Character & field record")
    skill_heading = page.get_by_role("heading", name="Synthesis", exact=True)
    expect(skill_heading).to_have_count(1)
    skill_card = skill_heading.locator("xpath=..")
    expect(skill_card).to_contain_text("0 recorded multi-source Synthesis Clerk attempts")
    after_character = authoritative_snapshot(page)
    assert_canonical_state_unchanged(before_board, after_character, "Reading the Witness character record")
    return {
        "witnessId": witness["id"],
        "founderObjectiveHidden": True,
        "witnessObjectiveStatus": "OPEN",
        "witnessObjectiveProgress": "0/1",
        "witnessSynthesisSkillCount": 0,
        "founderResponseVisibleInSharedHistory": True
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
        "evidenceBoundary": "A structurally valid collaborator response is retained as untrusted history; no independent source observation, truth, execution, XP, approval, mastery, or authority is established."
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
