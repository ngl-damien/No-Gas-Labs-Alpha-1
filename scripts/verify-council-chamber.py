"""Touch-first acceptance for the walkable Council Chamber on narrow phones.

This focused browser journey routes to the institution, taps its actual map
landmark, and exercises all four bounded review-summary branches. Inspection
must remain a read-only projection and never award progress.
"""
import argparse
import json
import select
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SERVER = """import {createGameServer} from './game/server.mjs';
const server=await createGameServer({
  dataDir:process.argv[1],
  founderKey:'fake-browser-fixture-key-not-a-secret'
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.once('SIGTERM',()=>server.closeGame());"""


def launch_server(data_dir):
    process = subprocess.Popen(
        ['node', '--input-type=module', '-e', SERVER, str(data_dir)],
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
        raise AssertionError('Disposable game server did not become ready within 15 seconds.')
    line = process.stdout.readline()
    if not line:
        detail = process.stderr.read()
        process.wait(timeout=10)
        raise AssertionError('Disposable game server exited before readiness: ' + detail)
    return process, 'http://127.0.0.1:' + str(json.loads(line)['port']) + '/'


def stop_server(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise AssertionError('Disposable game server did not shut down cleanly.')
    if process.returncode != 0:
        detail = process.stderr.read()
        raise AssertionError('Disposable game server exited ' + str(process.returncode) + ': ' + detail)


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
        creationVersions: world.creations.map(creation => [creation.id, creation.version])
      };
    }""")


def assert_council_room(page):
    content = page.locator('#sheet-content')
    expect(page.locator('#sheet-title')).to_have_text('Council Chamber')
    expect(content).to_have_attribute('data-council-chamber', 'true')
    expect(page.locator('#sheet-kicker')).to_contain_text('DELIBERATION ONLY')
    expect(content.locator('[data-council-coverage-progress]')).to_contain_text(
        '0/4 role attempts retained'
    )
    expect(content.locator('[data-council-role]')).to_have_count(4)
    expect(content.locator('[data-council-status="awaiting"]')).to_have_count(4)
    text = content.inner_text().lower()
    assert 'read-only' in text, 'Council inspection must disclose its read-only boundary.'
    assert 'not four independent humans, votes, or endorsements' in text, (
        'Role coverage must not be presented as consensus or endorsement.'
    )


def assert_populated_council_room(page, fixture):
    content = page.locator('#sheet-content')
    expect(page.locator('#sheet-title')).to_have_text('Council Chamber')
    expect(content).to_have_attribute('data-council-chamber', 'true')
    expect(content.locator('[data-council-coverage-progress]')).to_contain_text(
        '4/4 role attempts retained'
    )
    expect(content.locator('[data-council-role]')).to_have_count(4)
    expect(content.locator('[data-council-status="human-review"]')).to_have_count(4)
    labels = {
        'archivist': ['Event-chain findings', 'Claims · unverified', 'Linkage issues', 'Next checks'],
        'adversary': ['Challenge draft · not adjudicated', 'Counterexample to consider', 'Evidence requested'],
        'synthesizer': ['Recorded support · collaborator claims', 'Contradictions · dissent retained',
                        'Dissent event IDs preserved', 'Suggested next experiment · not run or approved'],
        'tutor': ['Concepts', 'Prerequisites', 'Explanation · general instruction, not mastery',
                  'Retrieval questions', 'Answer key · study aid, not mastery', 'What remains unproven']
    }
    for role, expected_labels in labels.items():
        card = content.locator('[data-council-role="' + role + '"]')
        details = card.locator('details[data-council-review-summary="' + role + '"]')
        expect(details).to_have_count(1)
        expect(details).to_have_attribute('data-council-review-status', 'valid-for-human-review')
        details.locator('summary').click()
        for label in expected_labels:
            expect(details).to_contain_text(label)
        if role == 'synthesizer':
            expect(details).to_contain_text(fixture['challengeEventId'])
        expect(details).to_contain_text('not independent evidence, truth, execution')
    text = content.inner_text().lower()
    assert 'read-only' in text, 'Council inspection must disclose its read-only boundary.'
    assert 'not four independent humans, votes, or endorsements' in text, (
        'Role coverage must not be presented as consensus or endorsement.'
    )


def seed_council_review_fixture(page):
    setup = page.evaluate("""async () => {
      const post = async action => {
        const response = await fetch('/api/action', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(action)
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(
          'Fixture action ' + action.type + ' failed (' + response.status + '): ' + JSON.stringify(payload)
        );
        return payload;
      };
      const stateResponse = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!stateResponse.ok) throw new Error('Initial fixture state read failed: ' + stateResponse.status);
      const initial = await stateResponse.json();
      const proposal = await post({
        type: 'propose-moonshot',
        title: 'Council Chamber acceptance fixture',
        hypothesis: 'A defined procedure produces a repeatable observation.',
        falsifier: 'A repeatable controlled result contradicts the hypothesis.',
        evidenceNeeded: 'An independently observed measurement.',
        requestId: 'council-mobile-fixture-proposal'
      });
      const moonshotId = proposal.result?.moonshotId;
      if (typeof moonshotId !== 'string') throw new Error('Fixture proposal did not return a Moonshot ID.');
      const report = await post({
        type: 'report-experiment',
        moonshotId,
        procedure: 'Run the bounded fixture procedure once.',
        observation: 'The expected result was not observed.',
        reportedOutcome: 'failed',
        requestId: 'council-mobile-fixture-report'
      });
      const reportId = report.result?.reportId;
      if (typeof reportId !== 'string') throw new Error('Fixture report did not return a report ID.');
      return { moonshotId, reportId, reporterActorId: initial.viewer.id };
    }""")

    rotated = page.evaluate("""async () => {
      const response = await fetch('/api/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error('Witness session rotation failed: ' + response.status);
      const dto = await response.json();
      return dto.viewer;
    }""")
    if rotated['id'] == setup['reporterActorId']:
        raise AssertionError('The challenge fixture must use a different Witness actor from the report author.')

    # Logout rotates to a new random Witness identity. The second actor can
    # retain dissent against the first actor's report without inventing a vote.
    page.reload(wait_until='networkidle')
    page.locator('#start-shared').tap()
    page.locator('#world').wait_for(state='visible')
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
    )
    return page.evaluate("""async fixture => {
      const post = async action => {
        const response = await fetch('/api/action', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(action)
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(
          'Fixture action ' + action.type + ' failed (' + response.status + '): ' + JSON.stringify(payload)
        );
        return payload;
      };
      const read = async () => {
        const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) throw new Error('Fixture state read failed: ' + response.status);
        return response.json();
      };
      const initial = await read();
      if (initial.viewer.id !== fixture.challengerActorId ||
          initial.viewer.id === fixture.reporterActorId) {
        throw new Error('The retained report and challenge must be authored by distinct Witness actors.');
      }
      const challenge = await post({
        type: 'challenge-experiment-report',
        reportId: fixture.reportId,
        challengeType: 'methodology',
        challengeText: 'The report does not describe a control condition.',
        requestId: 'council-mobile-fixture-challenge'
      });
      if (typeof challenge.result?.challengeId !== 'string') {
        throw new Error('The independent challenge action did not retain its challenge ID.');
      }

      const { projectCollaboratorPackets } = await import('/collaborator-contracts.mjs');
      const roles = ['archivist', 'adversary', 'synthesizer', 'tutor'];
      for (const role of roles) {
        const dto = await read();
        const packet = projectCollaboratorPackets(dto.world).find(candidate => candidate.id === role);
        if (!packet || packet.available !== true || packet.moonshotId !== fixture.moonshotId) {
          throw new Error('The ' + role + ' packet is unavailable for the retained fixture chain.');
        }
        const packetPayload = JSON.parse(packet.packetJson);
        const reportEvent = dto.world.events.find(event =>
          event.type === 'experiment-reported' && event.reportId === fixture.reportId
        );
        if (!reportEvent || reportEvent.actor.id !== fixture.reporterActorId) {
          throw new Error('The source report is not retained under the original Witness actor.');
        }
        const allChallenges = dto.world.events.filter(event =>
          event.type === 'experiment-challenged' && event.reportId === fixture.reportId
        );
        if (!allChallenges.length ||
            allChallenges.some(event => event.actor.id !== fixture.challengerActorId)) {
          throw new Error('The challenge must remain visible as dissent from the second Witness actor.');
        }
        const includedChallenges = allChallenges.filter(event => packet.inputRefs.includes(event.id));
        if (role !== 'tutor' && !includedChallenges.length) {
          throw new Error('The ' + role + ' packet must retain the relevant challenge in its bounded source slice.');
        }
        let response;
        if (role === 'archivist') {
          response = {
            eventChainFindings: ['The proposal precedes the failed report and retained challenge in this slice.'],
            claims: ['The reporter recorded a failed attempt.'],
            linkageIssues: [],
            unknowns: ['No independent measurement is attached.'],
            nextChecks: ['Inspect the original source and any retained measurement.']
          };
        } else if (role === 'adversary') {
          response = {
            targetEventId: reportEvent.id,
            challengeType: 'methodology',
            challengeDraft: 'The procedure does not state a control condition.',
            distinctnessAssessment: 'Compare this draft with the retained challenge before preserving it.',
            duplicateOfEventIds: [],
            counterexample: 'A controlled comparison could produce a different result.',
            evidenceNeeded: ['A retained controlled replication.'],
            unknowns: ['No independent measurement is supplied.']
          };
        } else if (role === 'synthesizer') {
          response = {
            scope: {
              moonshotId: fixture.moonshotId,
              includedEventIds: packet.inputRefs,
              omittedEventIds: packetPayload.omittedEventIds
            },
            recordedSupport: [{
              sourceEventIds: [reportEvent.id],
              statement: 'The retained report records a self-reported failed attempt.'
            }],
            contradictions: [],
            dissentPreserved: includedChallenges.map(event => event.id),
            unknowns: ['The report is not independently verified.'],
            nextDiscriminatingExperiment: {
              procedure: 'Repeat with a defined control and retain the observation.',
              outcome: 'Compare the controlled observation with the stated falsifier.'
            }
          };
        } else {
          response = {
            concepts: ['falsifiability'],
            prerequisites: ['distinguish observation from inference'],
            explanation: 'A falsifier specifies what observation would count against a claim.',
            questions: ['What result would contradict the hypothesis?'],
            answerKey: ['A repeatable observation matching the stated falsifier.'],
            whatRemainsUnproven: ['Whether the hypothesis survives a controlled replication.']
          };
        }
        const recorded = await post({
          type: 'record-collaborator-response',
          role,
          moonshotId: fixture.moonshotId,
          packetJson: packet.packetJson,
          sourceEventIds: packet.inputRefs,
          responseText: JSON.stringify(response),
          requestId: 'council-mobile-fixture-' + role
        });
        if (recorded.result?.validationStatus !== 'valid-for-human-review') {
          throw new Error('The ' + role + ' fixture response was not structurally accepted for human review.');
        }
      }

      const final = await read();
      const responses = final.world.events.filter(event => event.type === 'collaborator-response-recorded');
      const challengeEvent = final.world.events.find(event =>
        event.type === 'experiment-challenged' && event.reportId === fixture.reportId
      );
      if (!challengeEvent) throw new Error('The independent challenge event was not retained in world history.');
      if (responses.length !== 4 || responses.some(event => event.validationStatus !== 'valid-for-human-review')) {
        throw new Error('The fixture did not retain four structurally valid, review-only role attempts.');
      }
      if (final.world.xp !== 0) throw new Error('The research and collaborator fixture must not award XP.');
      return {
        revision: final.world.revision,
        xp: final.world.xp,
        eventCount: final.world.events.length,
        responseCount: responses.length,
        roles: responses.map(event => event.role).sort(),
        validationStatuses: responses.map(event => event.validationStatus),
        reporterActorId: fixture.reporterActorId,
        challengerActorId: fixture.challengerActorId,
        distinctActors: fixture.reporterActorId !== fixture.challengerActorId,
        challengeEventId: challengeEvent.id
      };
    }""", {
      'moonshotId': setup['moonshotId'],
      'reportId': setup['reportId'],
      'reporterActorId': setup['reporterActorId'],
      'challengerActorId': rotated['id']
    })


def council_canvas_tap_position(page):
    point = page.locator('#world').evaluate("""canvas => {
      const rect = canvas.getBoundingClientRect();
      const zoom = rect.width < 600 ? 0.78 : Math.max(0.64, Math.min(0.92, rect.width / 1500));
      const visibleWidth = rect.width / zoom;
      const visibleHeight = rect.height / zoom;
      const cameraX = Math.max(visibleWidth / 2, Math.min(1600 - visibleWidth / 2, 600));
      const cameraY = Math.max(visibleHeight / 2, Math.min(1000 - visibleHeight / 2, 190));
      return {
        x: rect.width / 2 + (500 - cameraX) * zoom,
        y: rect.height / 2 + (190 - cameraY) * zoom
      };
    }""")
    assert 0 <= point['x'] <= page.locator('#world').evaluate('(canvas) => canvas.clientWidth')
    assert 0 <= point['y'] <= page.locator('#world').evaluate('(canvas) => canvas.clientHeight')
    return point


def run_viewport(browser, url, out, width):
    context = browser.new_context(
        viewport={'width': width, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until='networkidle')
        page.locator('#start-shared').tap()
        page.locator('#world').wait_for(state='visible')
        expect(page.locator('#world')).to_have_attribute('data-world-renderer', 'pixel-v1')
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
        )

        before = authoritative_snapshot(page)
        page.locator('#places-button').tap()
        route = page.get_by_role('button', name='Walk to Council Chamber', exact=True)
        expect(route).to_be_visible()
        route.tap()

        # The route must end at the actual institution and open its owning panel.
        page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Council Chamber'",
            timeout=30000
        )
        assert_council_room(page)

        # A tap on the visible Council landmark must resolve the same institution ID,
        # not merely send the player toward an anonymous world coordinate.
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()
        page.wait_for_timeout(750)
        page.locator('#world').tap(position=council_canvas_tap_position(page))
        page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Council Chamber'",
            timeout=10000
        )
        assert_council_room(page)

        # The explicit Interact control remains a second, accessible way to enter.
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()
        page.locator('#interact-button').tap()
        page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Council Chamber'",
            timeout=10000
        )
        assert_council_room(page)

        after = authoritative_snapshot(page)
        assert after == before, (
            'Walking to or inspecting the Council Chamber must not append events, '
            'change the canonical revision, award XP, or create artifacts.'
        )
        expect(page.locator('#xp-count')).to_have_text(str(before['xp']))
        expect(page.locator('#creation-count')).to_have_text(str(len(before['creationVersions'])))

        fixture = None
        populated_before = None
        if width == 390:
            # Test fixture events are deliberately authored test data, not model
            # execution or independent evidence. Every response still crosses
            # the real server validator and is projected as review-only history.
            fixture = seed_council_review_fixture(page)
            populated_before = authoritative_snapshot(page)
            assert populated_before['xp'] == 0
            assert len(populated_before['eventIds']) == 7
            assert len(populated_before['creationVersions']) == 0
            assert fixture['responseCount'] == 4
            assert fixture['distinctActors'] is True

            # The route list brings the player beside the room; the canvas tap
            # then opens the actual map landmark and all four bounded summaries.
            page.locator('#places-button').tap()
            populated_route = page.get_by_role('button', name='Walk to Council Chamber', exact=True)
            expect(populated_route).to_be_visible()
            populated_route.tap()
            page.wait_for_function(
                "() => document.querySelector('#sheet-title')?.textContent === 'Council Chamber'",
                timeout=30000
            )
            assert_populated_council_room(page, fixture)
            page.locator('#sheet-close').tap()
            expect(page.locator('#sheet')).to_be_hidden()
            page.wait_for_timeout(750)
            page.locator('#world').tap(position=council_canvas_tap_position(page))
            page.wait_for_function(
                "() => document.querySelector('#sheet-title')?.textContent === 'Council Chamber'",
                timeout=10000
            )
            assert_populated_council_room(page, fixture)
            populated_after = authoritative_snapshot(page)
            assert populated_after == populated_before, (
                'Opening and expanding all four Council summaries must remain read-only.'
            )

        layout = page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          sheetWidth: document.querySelector('#sheet').clientWidth
        })""")
        assert layout['documentWidth'] <= layout['viewportWidth'] + 1, (
            'Council Chamber caused horizontal page overflow: ' + json.dumps(layout)
        )
        assert not errors, 'Browser page errors: ' + json.dumps(errors)
        screenshot = out / ('council-chamber-' + str(width) + '.png')
        page.screenshot(path=str(screenshot), full_page=True)
        return {
            'journey': 'touch-council-chamber-' + str(width),
            'passed': True,
            'viewport': width,
            'emptyRoleCards': 4,
            'emptyPendingRoles': 4,
            'emptyWorldRevision': before['revision'],
            'emptyWorldXp': before['xp'],
            'emptyWorldEvents': len(before['eventIds']),
            'emptyWorldCreations': len(before['creationVersions']),
            'emptyWorldStateUnchanged': True,
            'directCanvasTap': True,
            'roleSummaryBranches': ['archivist', 'adversary', 'synthesizer', 'tutor'] if fixture else [],
            'fixture': fixture,
            'populatedWorldStateUnchanged': populated_before is not None,
            'pageErrors': errors,
            'screenshot': screenshot.name
        }
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='/tmp/ngl-council-chamber')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='ngl-council-mobile-') as data_dir:
        process, url = launch_server(data_dir)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=['--no-sandbox'])
                try:
                    for width in (320, 390):
                        try:
                            result = run_viewport(browser, url, out, width)
                            results.append(result)
                            (out / 'results.json').write_text(json.dumps(results, indent=2))
                            print(json.dumps(result), flush=True)
                        except Exception as error:
                            results.append({
                                'journey': 'touch-council-chamber-' + str(width),
                                'passed': False,
                                'error': str(error)
                            })
                            (out / 'results.json').write_text(json.dumps(results, indent=2))
                            raise
                finally:
                    browser.close()
        finally:
            stop_server(process)
    print(json.dumps(results))


if __name__ == '__main__':
    main()
