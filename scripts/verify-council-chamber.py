"""Touch-first acceptance for walkable institutional rooms on narrow phones.

The Council Chamber journey inspects four bounded collaborator summaries. The
TownSquare journey exercises a real private report, Founder-session review,
actor-scoped visibility, self-review denial, and XP/moderation neutrality.
Both journeys enter through the world and preserve its playable canvas.
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
    expect(page.locator('#sheet')).to_be_visible()
    expect(page.locator('#sheet-close')).to_be_visible()
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
    return assert_world_context_visible(page)


def assert_world_context_visible(page, institution='Council Chamber'):
    geometry = page.evaluate("""() => {
      const canvas = document.querySelector('#world');
      const panel = document.querySelector('#sheet');
      const backdrop = document.querySelector('#sheet-backdrop');
      const canvasRect = canvas.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const canvasStyle = getComputedStyle(canvas);
      const backdropStyle = getComputedStyle(backdrop);
      return {
        canvasWidth: Math.round(canvasRect.width),
        canvasHeight: Math.round(canvasRect.height),
        exposedWorldHeight: Math.max(0, Math.round(Math.min(canvasRect.bottom, panelRect.top) - canvasRect.top)),
        canvasFilter: canvasStyle.filter,
        backdropFilter: backdropStyle.backdropFilter || backdropStyle.webkitBackdropFilter || 'none',
        backdropPointerEvents: backdropStyle.pointerEvents,
        sheetTop: Math.round(panelRect.top)
      };
    }""")
    assert geometry['canvasWidth'] > 0 and geometry['canvasHeight'] > 0, (
        'The world canvas must remain rendered while ' + institution + ' is open: ' + json.dumps(geometry)
    )
    assert geometry['exposedWorldHeight'] >= 100, (
        institution + ' must leave at least 100px of playable world context visible: ' + json.dumps(geometry)
    )
    assert geometry['canvasFilter'] == 'none', (
        'The world canvas must not be blurred behind the institution sheet: ' + json.dumps(geometry)
    )
    assert geometry['backdropFilter'] == 'none', (
        'The institution backdrop must not blur the world: ' + json.dumps(geometry)
    )
    assert geometry['backdropPointerEvents'] == 'none', (
        'The modeless institution sheet must not intercept world-canvas input: ' + json.dumps(geometry)
    )
    return geometry


def assert_populated_council_room(page, fixture):
    expect(page.locator('#sheet')).to_be_visible()
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
        summary = details.locator('summary')
        scroll_metrics = summary.evaluate("""el => {
          const panel = document.querySelector('#sheet');
          const panelRect = panel.getBoundingClientRect();
          const header = panel.querySelector('.sheet-top');
          const headerBottom = header ? header.getBoundingClientRect().bottom : panelRect.top;
          const item = el.getBoundingClientRect();
          const visibleTop = Math.max(panelRect.top, headerBottom) + 8;
          const visibleBottom = panelRect.bottom - 8;
          const delta = item.top < visibleTop
            ? item.top - visibleTop
            : item.bottom > visibleBottom
              ? item.bottom - visibleBottom
              : 0;
          const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
          panel.scrollTop = Math.max(0, Math.min(maxScroll, panel.scrollTop + delta));
          return {
            requestedDelta: Math.round(delta),
            scrollTop: Math.round(panel.scrollTop),
            maxScroll: Math.round(maxScroll)
          };
        }""")
        page.wait_for_timeout(50)
        summary_state = summary.evaluate("""el => {
          const panel = document.querySelector('#sheet');
          const panelRect = panel.getBoundingClientRect();
          const header = panel.querySelector('.sheet-top');
          const headerBottom = header ? header.getBoundingClientRect().bottom : panelRect.top;
          const item = el.getBoundingClientRect();
          const visibleTop = Math.max(panelRect.top, headerBottom) + 4;
          const visibleBottom = panelRect.bottom - 4;
          return {
            visible: item.width > 0 && item.height > 0 &&
              item.top >= visibleTop && item.bottom <= visibleBottom,
            itemTop: Math.round(item.top),
            itemBottom: Math.round(item.bottom),
            visibleTop: Math.round(visibleTop),
            visibleBottom: Math.round(visibleBottom),
            scrollTop: Math.round(panel.scrollTop),
            scrollHeight: Math.round(panel.scrollHeight),
            clientHeight: Math.round(panel.clientHeight)
          };
        }""")
        assert summary_state['visible'], (
            'Each bounded Council review summary must be reachable below the sticky header '
            'inside the mobile sheet scrollport (' + role + '): ' +
            json.dumps({**scroll_metrics, **summary_state})
        )
        close_in_view = page.locator('#sheet-close').evaluate("""el => {
          const button = el.getBoundingClientRect();
          const panel = document.querySelector('#sheet').getBoundingClientRect();
          return button.width > 0 && button.height > 0 &&
            button.top >= panel.top && button.bottom <= panel.bottom &&
            button.left >= panel.left && button.right <= panel.right;
        }""")
        assert close_in_view, 'The Council sheet close control must remain in the visible panel while role notes are inspected.'
        expect(page.locator('.sheet-top')).to_have_css('position', 'sticky')
        summary.tap()
        for label in expected_labels:
            expect(details).to_contain_text(label)
        summary.tap()  # Collapse before the next role so long notes do not compound the scroll height.
        if role == 'synthesizer':
            expect(details).to_contain_text(fixture['challengeEventId'])
        expect(details).to_contain_text('not independent evidence, truth, execution')
    text = content.inner_text().lower()
    assert 'read-only' in text, 'Council inspection must disclose its read-only boundary.'
    assert 'not four independent humans, votes, or endorsements' in text, (
        'Role coverage must not be presented as consensus or endorsement.'
    )
    return assert_world_context_visible(page)


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
      const resolutionRequest = 'Repeat the experiment with the control condition recorded and preserve the resulting observation.';
      const challenge = await post({
        type: 'challenge-experiment-report',
        reportId: fixture.reportId,
        challengeType: 'methodology',
        challengeText: 'The report does not describe a control condition.',
        resolutionRequest,
        requestId: 'council-mobile-fixture-challenge'
      });
      if (typeof challenge.result?.challengeId !== 'string') {
        throw new Error('The independent challenge action did not retain its challenge ID.');
      }
      const challengeState = await read();
      const retainedChallenge = challengeState.world.events.find(event =>
        event.type === 'experiment-challenged' && event.challengeId === challenge.result.challengeId
      );
      if (!retainedChallenge || retainedChallenge.resolutionRequest !== resolutionRequest ||
          Object.hasOwn(retainedChallenge, 'outcome') || Object.hasOwn(retainedChallenge, 'status')) {
        throw new Error('The retained challenge must preserve its exact requested next check without a verdict.');
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
            linkageIssues: ['The report has no independently retrieved source link.'],
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
            contradictions: [{
              sourceEventIds: [reportEvent.id, includedChallenges[0].id],
              statement: 'The failed outcome is retained, while the methodology challenge disputes whether the procedure supports the stated inference.'
            }],
            dissentPreserved: includedChallenges.map(event => event.id),
            authorResponsesPreserved: packetPayload.inputRecords
              .filter(record => record.type === 'experiment-challenge-responded')
              .map(record => record.eventId),
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
    point = page.locator('#world').evaluate("""async canvas => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Could not read the accepted player position for landmark navigation.');
      const dto = await response.json();
      const player = dto?.viewer?.position;
      if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
        throw new Error('The accepted player position is unavailable; do not guess the camera location.');
      }
      const rect = canvas.getBoundingClientRect();
      const zoom = rect.width < 600 ? 0.78 : Math.max(0.64, Math.min(0.92, rect.width / 1500));
      const visibleWidth = rect.width / zoom;
      const visibleHeight = rect.height / zoom;
      // Match WorldView.cameraTarget() instead of assuming the player reached
      // an exact pixel before the modeless institution panel stopped the route.
      const cameraX = Math.max(visibleWidth / 2, Math.min(1600 - visibleWidth / 2, player.x + 100));
      const cameraY = Math.max(visibleHeight / 2, Math.min(1000 - visibleHeight / 2, player.y - 50));
      return {
        x: rect.width / 2 + (500 - cameraX) * zoom,
        y: rect.height / 2 + (190 - cameraY) * zoom
      };
    }""")
    assert 0 <= point['x'] <= page.locator('#world').evaluate('(canvas) => canvas.clientWidth')
    assert 0 <= point['y'] <= page.locator('#world').evaluate('(canvas) => canvas.clientHeight')
    return point



def enter_nearby_institution(page, place_id, accessible_name, title, timeout=30000):
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
        "(expected) => document.querySelector('#sheet-title')?.textContent === expected && " 
        "!document.querySelector('#sheet').hidden",
        arg=title,
        timeout=timeout
    )

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

        # Arrival is navigation only; the nearby Interact control explicitly enters.
        enter_nearby_institution(page, 'council_chamber', 'Council Chamber', 'Council Chamber')
        assert_council_room(page)

        # A landmark tap is navigation, not entry. Preserve that distinction:
        # resolve the same institution ID, then use its explicit nearby Interact action.
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()
        page.wait_for_timeout(750)
        page.locator('#world').tap(position=council_canvas_tap_position(page))
        page.wait_for_function(
            "() => document.querySelector('#world')?.dataset.nearbyInstitutionId === 'council_chamber' && " +
            "document.querySelector('#sheet')?.hidden === true",
            timeout=10000
        )
        enter_nearby_institution(page, 'council_chamber', 'Council Chamber', 'Council Chamber', timeout=10000)
        assert_council_room(page)

        # The explicit Interact control remains a second, accessible way to enter.
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()
        enter_button = page.locator('#enter-institution-button')
        if enter_button.is_visible():
            enter_button.tap()
        else:
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
        if width in (320, 390):
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

            # The route list and canvas landmark are navigation only. The explicit
            # nearby Interact action is required to enter the institutional room.
            page.locator('#places-button').tap()
            populated_route = page.get_by_role('button', name='Walk to Council Chamber', exact=True)
            expect(populated_route).to_be_visible()
            populated_route.tap()
            enter_nearby_institution(page, 'council_chamber', 'Council Chamber', 'Council Chamber')
            assert_populated_council_room(page, fixture)
            page.locator('#sheet-close').tap()
            expect(page.locator('#sheet')).to_be_hidden()
            page.wait_for_timeout(750)
            page.locator('#world').tap(position=council_canvas_tap_position(page))
            page.wait_for_function(
                "() => document.querySelector('#world')?.dataset.nearbyInstitutionId === 'council_chamber' && " +
                "document.querySelector('#sheet')?.hidden === true",
                timeout=10000
            )
            enter_nearby_institution(page, 'council_chamber', 'Council Chamber', 'Council Chamber', timeout=10000)
            assert_populated_council_room(page, fixture)
            populated_after = authoritative_snapshot(page)
            assert populated_after == populated_before, (
                'Opening and expanding all four Council summaries must remain read-only.'
            )

            # The Synthesis Clerk's retained dissent must be directly inspectable
            # as the exact world event, pinned to the Council's source snapshot.
            synthesizer = page.locator('[data-council-role="synthesizer"]')
            synthesizer.locator(
                'details[data-council-review-summary="synthesizer"] summary'
            ).tap()
            source_event = synthesizer.locator(
                '[data-council-source-event-id="' + fixture['challengeEventId'] + '"]'
            )
            expect(source_event).to_have_count(1)
            expect(source_event).to_be_visible()
            source_event.tap()
            expect(page.locator('#sheet-title')).to_have_text('World Chronicle')
            chronicle = page.locator('#sheet-content')
            expect(chronicle).to_have_attribute(
                'data-chronicle-snapshot-revision', str(populated_before['revision'])
            )
            expect(chronicle.locator(
                '[data-event-id="world:' + fixture['challengeEventId'] + '"]'
            )).to_be_visible()
            chronicle_after = authoritative_snapshot(page)
            assert chronicle_after == populated_before, (
                'Opening a Council source-event link must remain pinned and read-only.'
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




def read_shared_state(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared state read failed: ' + response.status);
      const dto = await response.json();
      if (!dto.viewer || !dto.world || !Array.isArray(dto.world.events)) {
        throw new Error('Shared state omitted the viewer or retained world events.');
      }
      return dto;
    }""")


def shared_actor_page(browser, url, width, errors, label):
    context = browser.new_context(
        viewport={'width': width, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(label + ': ' + str(error)))
    page.goto(url, wait_until='networkidle')
    page.locator('#start-shared').tap()
    page.locator('#world').wait_for(state='visible')
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')",
        timeout=10000
    )
    viewer = read_shared_state(page)['viewer']
    if viewer.get('role') != 'witness':
        raise AssertionError(label + ' must begin as a distinct shared Witness session.')
    return context, page, viewer


def api_action(page, action):
    return page.evaluate("""async action => {
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action)
      });
      return { status: response.status, body: await response.json() };
    }""", action)


def town_square_navigation_diagnostics(page):
    return page.evaluate("""() => {
      const world = document.querySelector('#world');
      const sheet = document.querySelector('#sheet');
      const route = [...document.querySelectorAll('button')].find(button =>
        button.textContent.trim() === 'Walk to The Commons at TownSquare'
      );
      return {
        renderer: world?.dataset.worldRenderer ?? null,
        playerX: world?.dataset.playerX ?? null,
        playerY: world?.dataset.playerY ?? null,
        navigationTargetId: world?.dataset.navigationTargetId ?? null,
        navigationState: world?.dataset.navigationState ?? null,
        nearbyInstitutionId: world?.dataset.nearbyInstitutionId ?? null,
        sheetHidden: sheet?.hidden ?? null,
        placesButtonHidden: document.querySelector('#places-button')?.hidden ?? null,
        routeButtonVisible: Boolean(route && (
          route.offsetWidth || route.offsetHeight || route.getClientRects().length
        )),
        visibilityState: document.visibilityState
      };
    }""")


def fail_town_square_route(page, out, width, actor, phase, error):
    diagnostics = town_square_navigation_diagnostics(page)
    screenshot = Path(out) / f'town-square-{actor}-{width}px-{phase}-failure.png'
    screenshot.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(screenshot), full_page=True)
    raise AssertionError(
        f'TownSquare route {phase} failed for {actor} at {width}px: ' +
        json.dumps(diagnostics, sort_keys=True)
    ) from error


def open_town_square(page, out, width, actor):
    # The Council journey keeps several isolated actor contexts open. Bring the
    # actor being moved to the foreground and wait for its accepted render
    # position before asking the pixel world to compute a route.
    page.bring_to_front()
    if not page.locator('#sheet').is_hidden():
        page.locator('#sheet-close').tap()
    try:
        page.wait_for_function(
            """() => {
              const world = document.querySelector('#world');
              return world?.dataset.worldRenderer === 'pixel-v1' &&
                Number.isFinite(Number(world.dataset.playerX)) &&
                Number.isFinite(Number(world.dataset.playerY));
            }""",
            timeout=15000
        )
    except Exception as error:
        fail_town_square_route(page, out, width, actor, 'position-ready', error)

    page.locator('#places-button').tap()
    route = page.get_by_role('button', name='Walk to The Commons at TownSquare', exact=True)
    expect(route).to_be_visible()
    route.tap()
    try:
        page.wait_for_function(
            """() => {
              const world = document.querySelector('#world');
              return world?.dataset.navigationTargetId === 'town-square' &&
                ['walking', 'arrived', 'awaiting-range'].includes(world.dataset.navigationState);
            }""",
            timeout=15000
        )
    except Exception as error:
        fail_town_square_route(page, out, width, actor, 'start', error)
    try:
        page.wait_for_function(
            """() => {
              const world = document.querySelector('#world');
              return world?.dataset.navigationTargetId === 'town-square' &&
                world?.dataset.navigationState === 'arrived' &&
                world?.dataset.nearbyInstitutionId === 'town-square' &&
                document.querySelector('#sheet')?.hidden === true;
            }""",
            timeout=90000
        )
    except Exception as error:
        fail_town_square_route(page, out, width, actor, 'arrival', error)

    enter = page.locator('#enter-institution-button')
    if enter.is_visible():
        enter.tap()
    else:
        interact = page.locator('#interact-button')
        expect(interact).to_be_visible()
        interact.tap()
    page.wait_for_function(
        """() => document.querySelector('#sheet-title')?.textContent === 'The Commons at TownSquare' &&
          document.querySelector('#sheet-content')?.dataset.commonsPanel === 'true' &&
          document.querySelector('#sheet')?.hidden === false""",
        timeout=15000
    )
    expect(page.locator('#commons-compose')).to_be_visible()
    assert_world_context_visible(page, 'The Commons at TownSquare')


def run_town_square_report_review(browser, url, out, width):
    contexts = []
    errors = []
    try:
        author_context, author_page, author = shared_actor_page(browser, url, width, errors, 'author')
        contexts.append(author_context)
        reporter_context, reporter_page, reporter = shared_actor_page(browser, url, width, errors, 'reporter')
        contexts.append(reporter_context)
        unrelated_context, unrelated_page, unrelated = shared_actor_page(browser, url, width, errors, 'unrelated')
        contexts.append(unrelated_context)
        founder_context, founder_page, _ = shared_actor_page(browser, url, width, errors, 'founder')
        contexts.append(founder_context)

        expect(founder_page.locator('#login-button')).to_be_visible()
        founder_page.locator('#login-button').tap()
        founder_page.locator('#founder-name').fill('Damien')
        founder_page.locator('#founder-key').fill('fake-browser-fixture-key-not-a-secret')
        founder_page.locator('#verify-founder').tap()
        # The UI login handler does not finish when /api/login first returns:
        # it accepts that DTO, then startShared() revalidates the session and opens
        # the shared stream before emitting this success toast. Wait for that whole
        # transition so the next authoritative read cannot race the second fetch.
        founder_page.wait_for_function(
            """() => {
              const toast = document.querySelector('#toast');
              const login = document.querySelector('#login-button');
              const logout = document.querySelector('#logout-button');
              return Boolean(
                toast && !toast.hidden &&
                toast.textContent === 'Founder session verified by the local service.' &&
                login?.hidden === true &&
                logout?.hidden === false
              );
            }""",
            timeout=15000
        )
        founder = read_shared_state(founder_page)['viewer']
        observed_actors = {
            'author': {'id': author.get('id'), 'role': author.get('role')},
            'reporter': {'id': reporter.get('id'), 'role': reporter.get('role')},
            'unrelated': {'id': unrelated.get('id'), 'role': unrelated.get('role')},
            'founder': {'id': founder.get('id'), 'role': founder.get('role')}
        }
        if len({author['id'], reporter['id'], unrelated['id'], founder['id']}) != 4:
            raise AssertionError(
                'Author, reporter, unrelated Witness and Founder must be distinct actors: ' +
                json.dumps(observed_actors, sort_keys=True)
            )
        if founder.get('role') != 'founder' or any(
            actor.get('role') != 'witness' for actor in (author, reporter, unrelated)
        ):
            raise AssertionError(
                'Only the authenticated Founder session may review Commons reports: ' +
                json.dumps(observed_actors, sort_keys=True)
            )

        # Enter through the map's TownSquare route and its explicit nearby Interact action.
        open_town_square(reporter_page, out, width, 'reporter')
        open_town_square(founder_page, out, width, 'founder')
        xp_before_actions = read_shared_state(founder_page)['world']['xp']

        message_one_text = 'TownSquare review fixture: author message for a separate Witness report.'
        message_two_text = 'TownSquare review fixture: reporter message for the Founder self-review boundary.'
        setup_actions = [
            (author_page, {
                'type': 'post-message', 'text': message_one_text,
                'requestId': 'town-square-mobile-' + str(width) + '-author-post'
            }),
            (reporter_page, {
                'type': 'post-message', 'text': message_two_text,
                'requestId': 'town-square-mobile-' + str(width) + '-reporter-post'
            })
        ]
        message_ids = []
        for page, action in setup_actions:
            result = api_action(page, action)
            if result['status'] != 200:
                raise AssertionError('Server-validated Commons message fixture failed: ' + json.dumps(result))
            message_id = result['body'].get('result', {}).get('messageId')
            if not isinstance(message_id, str) or not message_id:
                raise AssertionError('Commons message fixture omitted its exact message ID.')
            message_ids.append(message_id)
        message_one_id, message_two_id = message_ids
        for page in (reporter_page, founder_page):
            for message_id, message_text in zip(message_ids, (message_one_text, message_two_text)):
                card = page.locator('[data-commons-message-id="' + message_id + '"]')
                expect(card).to_be_visible()
                expect(card).to_contain_text(message_text)

        report_actions = [
            (reporter_page, {
                'type': 'report-message', 'messageId': message_one_id,
                'reason': 'privacy',
                'details': 'Please review the retained message as a process matter; no verdict is requested.',
                'requestId': 'town-square-mobile-' + str(width) + '-reporter-report'
            }),
            (founder_page, {
                'type': 'report-message', 'messageId': message_two_id,
                'reason': 'privacy',
                'details': 'Founder-authored report fixture; the same Founder session must not review it.',
                'requestId': 'town-square-mobile-' + str(width) + '-founder-report'
            })
        ]
        report_ids = []
        for page, action in report_actions:
            result = api_action(page, action)
            if result['status'] != 200:
                raise AssertionError('Server-validated private report fixture failed: ' + json.dumps(result))
            report_id = result['body'].get('result', {}).get('reportId')
            if not isinstance(report_id, str) or not report_id:
                raise AssertionError('Commons report action omitted its exact report ID.')
            report_ids.append(report_id)
        report_one_id, report_two_id = report_ids
        if report_one_id == report_two_id:
            raise AssertionError('Independent report events must have distinct IDs.')

        founder_before_review = read_shared_state(founder_page)
        report_events_before = [
            event for event in founder_before_review['world']['events']
            if event.get('type') == 'message-reported' and event.get('reportId') == report_one_id
        ]
        if len(report_events_before) != 1:
            raise AssertionError('The pending map object must bind one exact retained report event.')
        pending_report_event = report_events_before[0]
        pending_report_details = 'Please review the retained message as a process matter; no verdict is requested.'

        def assert_pending_report_map_object(page, label):
            canvas = page.locator('#world')
            page.wait_for_function(
                """expected => {
                  const canvas = document.querySelector('#world');
                  const objects = JSON.parse(canvas?.dataset.townSquareReviewObjects || '[]');
                  return objects.some(object =>
                    object.eventId === expected && object.status === 'awaiting-founder-review'
                  );
                }""",
                arg=pending_report_event['id'],
                timeout=15000
            )
            expect(canvas).to_have_attribute('data-town-square-review-count', '1')
            expect(canvas).to_have_attribute('data-town-square-review-visible-count', '1')
            expect(canvas).to_have_attribute('data-town-square-review-pending-count', '1')
            expect(canvas).to_have_attribute('data-town-square-review-record-count', '0')
            queue_accessibility = canvas.get_attribute('aria-label') or ''
            if '1 pending report(s)' not in queue_accessibility or \
                    '0 retained process review record(s)' not in queue_accessibility:
                raise AssertionError(label + ' TownSquare landmark accessibility must expose its actor-visible pending/process counts.')
            expect(canvas).to_have_attribute(
                'data-town-square-review-history-status', 'actor-visible-links-validated'
            )
            objects = canvas.evaluate(
                "canvas => JSON.parse(canvas.dataset.townSquareReviewObjects || '[]')"
            )
            if len(objects) != 1 or objects[0].get('eventId') != pending_report_event['id'] or \
                    objects[0].get('status') != 'awaiting-founder-review':
                raise AssertionError(label + ' must receive the exact pending report map object: ' + json.dumps(objects))
            if set(objects[0]) != {'id', 'eventId', 'x', 'y', 'status'}:
                raise AssertionError(label + ' pending map object must expose only navigation identity, coordinates and status.')
            control = page.locator(
                '[data-town-square-review-control="' + pending_report_event['id'] + '"]'
            )
            expect(control).to_have_count(1)
            expect(control).to_have_text('P')
            expect(control).to_have_attribute(
                'data-town-square-review-status', 'awaiting-founder-review'
            )
            control_label = control.get_attribute('aria-label') or ''
            serialized = json.dumps(objects) + control_label
            if pending_report_details in serialized or 'pending TownSquare report' not in control_label:
                raise AssertionError(label + ' pending map marker must not expose private report text and must name its bounded action.')
            return objects

        founder_pending_map = assert_pending_report_map_object(founder_page, 'Founder')
        reporter_pending_map = assert_pending_report_map_object(reporter_page, 'reporter')
        if founder_pending_map != reporter_pending_map:
            raise AssertionError('Founder and reporting Witness must receive the same deterministic pending report marker.')

        reporter_page.wait_for_function(
            """messageId => document.querySelector('[data-commons-own-report="' + messageId + '"]')?.dataset.commonsOwnReportStatus === 'awaiting-founder-review'""",
            arg=message_one_id,
            timeout=15000
        )
        founder_page.wait_for_function(
            """() => document.querySelector('#commons-pending-reports')?.textContent.includes('PENDING FOUNDER REVIEW · 2')""",
            timeout=15000
        )
        pending_before = founder_page.locator('#commons-pending-reports')
        expect(pending_before).to_contain_text('does not change message visibility')

        founder_before_review = read_shared_state(founder_page)
        if founder_before_review['world']['xp'] != xp_before_actions:
            raise AssertionError('Posting and reporting Commons messages must not create XP.')
        revision_before = founder_before_review['world']['revision']
        xp_before = founder_before_review['world']['xp']
        event_ids_before = [event['id'] for event in founder_before_review['world']['events']]

        review_note = 'Reviewed as a process step; this note is not a factual verdict or moderation action.'
        lost_review_response = {
            'attempted': False,
            'serverStatus': None,
            'requestId': None,
            'reviewId': None,
            'reviewEventId': None
        }

        def drop_first_committed_review_response(route):
            payload = route.request.post_data_json
            if (
                not lost_review_response['attempted'] and
                isinstance(payload, dict) and
                payload.get('type') == 'review-message-report' and
                payload.get('reportId') == report_one_id
            ):
                lost_review_response['attempted'] = True
                server_response = route.fetch()
                server_body = server_response.json()
                if server_response.status != 200:
                    raise AssertionError(
                        'The server must commit the first review before the response is dropped: ' +
                        json.dumps({'status': server_response.status, 'body': server_body})
                    )
                committed = [
                    event for event in server_body.get('world', {}).get('events', [])
                    if event.get('type') == 'message-report-reviewed' and
                    event.get('reportId') == report_one_id
                ]
                if len(committed) != 1:
                    raise AssertionError(
                        'The server-side first attempt must append exactly one review before response loss.'
                    )
                request_id = payload.get('requestId')
                if not isinstance(request_id, str) or not request_id:
                    raise AssertionError('The review request must carry its saved Relay request ID.')
                lost_review_response.update({
                    'serverStatus': server_response.status,
                    'requestId': request_id,
                    'reviewId': server_body.get('result', {}).get('reviewId'),
                    'reviewEventId': committed[0].get('id')
                })
                founder_context.set_offline(True)
                route.abort('internetdisconnected')
                return
            route.continue_()

        report_item = founder_page.locator('[data-commons-pending-report="' + report_one_id + '"]')
        expect(report_item).to_be_visible()
        report_item.locator('summary').tap()
        founder_page.locator('[id="commons-review-note-' + report_one_id + '"]').fill(review_note)
        founder_page.route('**/api/action', drop_first_committed_review_response)
        founder_page.locator('[data-commons-review="' + report_one_id + '"]').tap()

        # The route handler marks attempted before its nested route.fetch() has
        # completed. Wait for the offline transition it triggers after the server
        # has committed the review; checking the Python receipt immediately after
        # tap races that handler and can close the context while route.fetch runs.
        founder_page.wait_for_function(
            """() => document.querySelector('#connection-dot')?.dataset.connectionState === 'offline'""",
            timeout=15000
        )
        if not lost_review_response['attempted'] or lost_review_response['serverStatus'] != 200:
            raise AssertionError('The fault injector did not observe a committed review response to drop.')
        pending_receipts = founder_page.evaluate("""() => {
          const matches = [];
          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            let value = null;
            try { value = JSON.parse(localStorage.getItem(key)); } catch {}
            if (value && value.action?.type === 'review-message-report') matches.push({key, value});
          }
          return matches;
        }""")
        if len(pending_receipts) != 1:
            raise AssertionError(
                'After response loss, exactly one local Relay receipt must remain: ' +
                json.dumps(pending_receipts)
            )
        pending_receipt = pending_receipts[0]['value']
        if pending_receipt.get('requestId') != lost_review_response['requestId'] or \
                pending_receipt.get('actorId') != founder.get('id') or \
                pending_receipt.get('actorRole') != 'founder' or \
                pending_receipt.get('action', {}).get('reportId') != report_one_id or \
                pending_receipt.get('action', {}).get('note') != review_note:
            raise AssertionError('The saved Relay receipt must retain the exact actor, request ID and review action.')

        # The server committed, so the separate reporter session can observe the
        # review while the Founder still has an uncertain local response.
        reporter_page.wait_for_function(
            """messageId => document.querySelector('[data-commons-own-report="' + messageId + '"]')?.dataset.commonsOwnReportStatus === 'founder-review-recorded'""",
            arg=message_one_id,
            timeout=15000
        )
        replay_responses = []

        def capture_review_replay(response):
            try:
                payload = response.request.post_data_json
                if (
                    isinstance(payload, dict) and
                    payload.get('type') == 'review-message-report' and
                    payload.get('requestId') == lost_review_response['requestId']
                ):
                    replay_responses.append({'status': response.status, 'body': response.json()})
            except Exception as error:
                replay_responses.append({'captureError': str(error)})

        founder_page.on('response', capture_review_replay)
        founder_page.unroute('**/api/action', drop_first_committed_review_response)
        founder_context.set_offline(False)
        founder_page.wait_for_function(
            """() => {
              const toast = document.querySelector('#toast');
              return Boolean(toast && !toast.hidden &&
                toast.textContent.includes('Relay recovered the exact pending action after reconnection.'));
            }""",
            timeout=20000
        )
        founder_page.wait_for_function("""() => {
          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            let value = null;
            try { value = JSON.parse(localStorage.getItem(key)); } catch {}
            if (value && value.action?.type === 'review-message-report') return false;
          }
          return true;
        }""", timeout=15000)
        if len(replay_responses) != 1 or 'body' not in replay_responses[0]:
            raise AssertionError('The Relay must produce one observable exact-request replay response: ' + json.dumps(replay_responses))
        replay = replay_responses[0]
        replay_body = replay['body']
        if replay.get('status') != 200 or replay_body.get('idempotentReplay') is not True or \
                replay_body.get('requestId') != lost_review_response['requestId'] or \
                replay_body.get('result', {}).get('reviewId') != lost_review_response['reviewId']:
            raise AssertionError(
                'The recovered review must reuse the same request/result as an idempotent replay: ' +
                json.dumps({'first': lost_review_response, 'replay': replay})
            )
        founder_page.wait_for_function(
            """reportId => !document.querySelector('[data-commons-pending-report="' + reportId + '"]')""",
            arg=report_one_id,
            timeout=15000
        )

        # The reporter's open sheet must receive the exact review over the shared stream.
        reporter_page.wait_for_function(
            """messageId => document.querySelector('[data-commons-own-report="' + messageId + '"]')?.dataset.commonsOwnReportStatus === 'founder-review-recorded'""",
            arg=message_one_id,
            timeout=15000
        )
        reporter_status = reporter_page.locator('[data-commons-own-report="' + message_one_id + '"]')
        expect(reporter_status).to_contain_text(review_note)
        expect(reporter_status).to_contain_text('not a factual verdict')
        expect(reporter_page.locator('#commons-pending-reports')).to_have_count(0)

        founder_pending = founder_page.locator('#commons-pending-reports')
        expect(founder_pending).to_contain_text('PENDING FOUNDER REVIEW · 1')
        expect(founder_pending).to_contain_text(
            'does not change message visibility or establish factual truth'
        )
        expect(founder_page.locator(
            '[data-commons-pending-report="' + report_one_id + '"]'
        )).to_have_count(0)
        self_review_item = founder_page.locator(
            '[data-commons-pending-report="' + report_two_id + '"]'
        )
        expect(self_review_item).to_be_visible()
        self_review_item.locator('summary').tap()
        expect(self_review_item).to_contain_text('Self-review is blocked for this Founder session.')
        expect(self_review_item.locator(
            '[data-commons-review="' + report_two_id + '"]'
        )).to_have_count(0)

        founder_after_review = read_shared_state(founder_page)
        reporter_after_review = read_shared_state(reporter_page)
        author_state = read_shared_state(author_page)
        unrelated_state = read_shared_state(unrelated_page)
        founder_events = founder_after_review['world']['events']
        reporter_events = reporter_after_review['world']['events']

        review_events = [
            event for event in founder_events
            if event.get('type') == 'message-report-reviewed' and event.get('reportId') == report_one_id
        ]
        if len(review_events) != 1:
            raise AssertionError('Founder review must append exactly one linked retained event.')
        review_event = review_events[0]
        if review_event.get('messageId') != message_one_id or review_event.get('note') != review_note or \
                review_event.get('actor', {}).get('role') != 'founder' or \
                review_event.get('actor', {}).get('id') != founder['id']:
            raise AssertionError('The exact review event must retain report, message, note and Founder identity.')
        if review_event.get('id') != lost_review_response['reviewEventId'] or \
                review_event.get('reviewId') != lost_review_response['reviewId']:
            raise AssertionError('The recovered Relay result must identify the exact first committed review event.')
        source_message_events = [
            event for event in founder_events
            if event.get('type') == 'message-posted' and event.get('messageId') == message_one_id
        ]
        source_report_events = [
            event for event in founder_events
            if event.get('type') == 'message-reported' and event.get('reportId') == report_one_id
        ]
        if len(source_message_events) != 1 or len(source_report_events) != 1:
            raise AssertionError('The review objective requires one exact original message and report event.')
        message_event = source_message_events[0]
        report_event = source_report_events[0]
        source_chain = [message_event, report_event, review_event]
        source_chain_ids = [event['id'] for event in source_chain]
        source_chain_positions = [founder_events.index(event) for event in source_chain]
        if not source_chain_positions[0] < source_chain_positions[1] < source_chain_positions[2]:
            raise AssertionError('The original message, private report and Founder review must remain append-ordered.')
        if not all(any(event.get('id') == event_id for event in reporter_events) for event_id in source_chain_ids):
            raise AssertionError('The reporting Witness must receive its exact message → report → review source chain.')
        if founder_after_review['world']['revision'] != revision_before + 1 or \
                founder_after_review['world']['xp'] != xp_before:
            raise AssertionError('A review must append one revision and award zero XP.')
        event_ids_after = [event['id'] for event in founder_events]
        if len(event_ids_after) != len(event_ids_before) + 1 or event_ids_after[:-1] != event_ids_before:
            raise AssertionError('Review must append one event without rewriting retained history.')

        def private_events(state):
            return [
                event for event in state['world']['events']
                if event.get('type') in ('message-reported', 'message-report-reviewed')
            ]

        if private_events(author_state) or private_events(unrelated_state):
            raise AssertionError('Message authors and unrelated Witnesses must not receive private report/review events.')
        if {event.get('reportId') for event in private_events(reporter_after_review)} != {report_one_id}:
            raise AssertionError('The reporter must see only its own report and linked review.')
        if {event.get('reportId') for event in private_events(founder_after_review)} != {report_one_id, report_two_id}:
            raise AssertionError('The Founder must see both reports and the one permitted review.')
        report_events = {
            event.get('reportId'): event for event in founder_events
            if event.get('type') == 'message-reported'
        }
        if report_events.get(report_one_id, {}).get('actor', {}).get('id') != reporter['id'] or \
                report_events.get(report_two_id, {}).get('actor', {}).get('id') != founder['id']:
            raise AssertionError('Each private report must retain its exact reporting actor.')
        if any(
            event.get('type') == 'message-moderated'
            for state in (author_state, reporter_after_review, unrelated_state, founder_after_review)
            for event in state['world']['events']
        ):
            raise AssertionError('A process review must not create a moderation event.')

        for state in (author_state, reporter_after_review, unrelated_state, founder_after_review):
            messages = {
                event.get('messageId'): event.get('text')
                for event in state['world']['events']
                if event.get('type') == 'message-posted'
            }
            if messages.get(message_one_id) != message_one_text or messages.get(message_two_id) != message_two_text:
                raise AssertionError('Review must not remove or rewrite either original Commons message.')

        # Rejected Witness review and Founder self-review attempts must not mutate history.
        before_rejections = read_shared_state(founder_page)
        unauthorized = api_action(reporter_page, {
            'type': 'review-message-report', 'reportId': report_one_id,
            'note': 'Witness attempt must be rejected.'
        })
        if unauthorized['status'] != 403:
            raise AssertionError('Witness review must return 403: ' + json.dumps(unauthorized))
        self_review = api_action(founder_page, {
            'type': 'review-message-report', 'reportId': report_two_id,
            'note': 'Self-review attempt must be rejected.'
        })
        if self_review['status'] != 409 or self_review['body'].get('error', {}).get('code') != 'SELF_REVIEW':
            raise AssertionError('Founder self-review must return 409 SELF_REVIEW: ' + json.dumps(self_review))
        after_rejections = read_shared_state(founder_page)
        if after_rejections['world']['revision'] != before_rejections['world']['revision'] or \
                after_rejections['world']['xp'] != before_rejections['world']['xp'] or \
                [event['id'] for event in after_rejections['world']['events']] != [
                    event['id'] for event in before_rejections['world']['events']
                ]:
            raise AssertionError('Rejected review attempts must not mutate revision, XP or retained history.')

        for page, label in ((reporter_page, 'reporter'), (founder_page, 'Founder')):
            layout = page.evaluate("""() => ({
              viewportWidth: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              sheetWidth: document.querySelector('#sheet').clientWidth
            })""")
            if layout['documentWidth'] > layout['viewportWidth'] + 1:
                raise AssertionError(label + ' TownSquare caused horizontal overflow: ' + json.dumps(layout))
            assert_world_context_visible(page, 'The Commons at TownSquare')

        reporter_screenshot = out / ('town-square-reporter-review-' + str(width) + '.png')
        founder_screenshot = out / ('town-square-founder-review-' + str(width) + '.png')
        reporter_page.screenshot(path=str(reporter_screenshot), full_page=True)
        founder_page.screenshot(path=str(founder_screenshot), full_page=True)

        def actor_visible_review_objects(page, label, expected_count):
            canvas = page.locator('#world')
            expect(canvas).to_have_attribute('data-town-square-review-count', str(expected_count))
            expect(canvas).to_have_attribute('data-town-square-review-visible-count', str(expected_count))
            expect(canvas).to_have_attribute('data-town-square-review-pending-count', '0')
            expect(canvas).to_have_attribute('data-town-square-review-record-count', str(expected_count))
            queue_accessibility = canvas.get_attribute('aria-label') or ''
            if '0 pending report(s)' not in queue_accessibility or \
                    f'{expected_count} retained process review record(s)' not in queue_accessibility:
                raise AssertionError(label + ' TownSquare accessibility counts must remain actor-scoped after review.')
            expect(canvas).to_have_attribute('data-town-square-review-history-status', 'actor-visible-links-validated')
            objects = canvas.evaluate(
                "canvas => JSON.parse(canvas.dataset.townSquareReviewObjects || '[]')"
            )
            if len(objects) != expected_count:
                raise AssertionError(label + ' received an unexpected number of TownSquare review map objects: ' + json.dumps(objects))
            if expected_count:
                if objects[0].get('eventId') != review_event['id']:
                    raise AssertionError(label + ' map object must link the exact retained Founder review event.')
                if set(objects[0]) != {'id', 'eventId', 'x', 'y'}:
                    raise AssertionError(label + ' map object must expose only its safe navigation identity and coordinates.')
                serialized = json.dumps(objects)
                if review_note in serialized or report_event.get('details', '') in serialized:
                    raise AssertionError(label + ' map object must not copy private report or review text.')
            controls = page.locator('[data-town-square-review-control]')
            expect(controls).to_have_count(expected_count)
            if expected_count:
                expect(controls.first).to_have_attribute('data-event-id', review_event['id'])
                control_label = controls.first.get_attribute('aria-label') or ''
                if review_note in control_label or report_event.get('details', '') in control_label:
                    raise AssertionError(label + ' map control must not expose private report or review text.')
            return objects

        founder_map_objects = actor_visible_review_objects(founder_page, 'Founder', 1)
        reporter_map_objects = actor_visible_review_objects(reporter_page, 'reporter', 1)
        actor_visible_review_objects(author_page, 'message author', 0)
        actor_visible_review_objects(unrelated_page, 'unrelated Witness', 0)
        if founder_map_objects != reporter_map_objects:
            raise AssertionError('Founder and reporting Witness must receive the same deterministic map identity for their shared exact review record.')

        def inspect_town_square_review_map_object(page, label):
            if page.locator('#sheet').is_visible():
                page.locator('#sheet-close').tap()
            expect(page.locator('#sheet')).to_be_hidden()
            before = read_shared_state(page)['world']
            control_selector = '[data-town-square-review-control="' + review_event['id'] + '"]'
            control = page.locator(control_selector)
            expect(control).to_have_count(1)
            expect(control).to_be_visible()
            expect(control).to_have_attribute('data-event-id', review_event['id'])
            control_state = control.evaluate("""button => {
              button.dataset.testPointerType = 'not-observed';
              button.addEventListener('pointerdown', event => {
                button.dataset.testPointerType = event.pointerType;
              }, { once: true });
              const rect = button.getBoundingClientRect();
              return {
                eventId: button.dataset.eventId || null,
                worldX: Number(button.dataset.worldX),
                worldY: Number(button.dataset.worldY),
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight
              };
            }""")
            marker = page.locator('#world').evaluate("""(canvas, eventId) => {
              const objects = JSON.parse(canvas.dataset.townSquareReviewObjects || '[]');
              const object = objects.find(item => item.eventId === eventId);
              if (!object) return null;
              return {
                eventId: object.eventId,
                worldX: object.x,
                worldY: object.y
              };
            }""", review_event['id'])
            controls_geometry = page.locator('[data-town-square-review-control]').evaluate_all("""buttons => {
              return buttons.filter(button => !button.hidden).map(button => {
                const rect = button.getBoundingClientRect();
                return {
                  eventId: button.dataset.eventId || null,
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom
                };
              });
            }""")
            overlay_geometry = page.locator(
                '.masthead, #quest-card, .quest-card, .world-stats, .map-label, .movement-pad, ' +
                '.world-tools, .interact-button, .ngl-world-collaborator-controls, #sheet, #portal, #toast'
            ).evaluate_all("""elements => elements.map(element => {
              const rect = element.getBoundingClientRect();
              return {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom};
            }).filter(rect => rect.right > rect.left && rect.bottom > rect.top)""")
            if not marker or control_state['eventId'] != review_event['id'] or \
                    control_state['worldX'] != marker['worldX'] or \
                    control_state['worldY'] != marker['worldY']:
                raise AssertionError(
                    label + ' touch control must retain the exact actor-visible event and original world coordinates: ' +
                    json.dumps({'control': control_state, 'marker': marker}, sort_keys=True)
                )
            if abs(control_state['width'] - 44) > 1 or abs(control_state['height'] - 44) > 1 or \
                    control_state['left'] < -1 or control_state['top'] < -1 or \
                    control_state['right'] > control_state['viewportWidth'] + 1 or \
                    control_state['bottom'] > control_state['viewportHeight'] + 1:
                raise AssertionError(
                    label + ' touch control must be a visible 44px target inside the mobile viewport: ' +
                    json.dumps(control_state, sort_keys=True)
                )
            for left_index, left_control in enumerate(controls_geometry):
                for right_control in controls_geometry[left_index + 1:]:
                    if left_control['left'] < right_control['right'] and \
                            left_control['right'] > right_control['left'] and \
                            left_control['top'] < right_control['bottom'] and \
                            left_control['bottom'] > right_control['top']:
                        raise AssertionError(
                            label + ' TownSquare review touch targets must not overlap: ' +
                            json.dumps({'left': left_control, 'right': right_control}, sort_keys=True)
                        )
            for overlay in overlay_geometry:
                if control_state['left'] < overlay['right'] and \
                        control_state['right'] > overlay['left'] and \
                        control_state['top'] < overlay['bottom'] and \
                        control_state['bottom'] > overlay['top']:
                    raise AssertionError(
                        label + ' TownSquare review touch panel must not cover a reserved HUD overlay: ' +
                        json.dumps({'control': control_state, 'overlay': overlay}, sort_keys=True)
                    )
            control.tap()
            pointer_type = control.get_attribute('data-test-pointer-type')
            if pointer_type != 'touch':
                raise AssertionError(
                    label + ' TownSquare review control must receive a real touch pointer; observed ' +
                    str(pointer_type)
                )
            try:
                page.wait_for_function(
                    """expected => {
                      const sheet = document.querySelector('#sheet');
                      const world = document.querySelector('#world');
                      const chronicleOpen = sheet?.hidden === false &&
                        document.querySelector('#sheet-title')?.textContent === 'World Chronicle';
                      const routedToReview = sheet?.hidden === true &&
                        world?.dataset.navigationTargetId === expected &&
                        ['walking', 'arrived', 'awaiting-range'].includes(world.dataset.navigationState);
                      return chronicleOpen || routedToReview;
                    }""",
                    arg=review_event['id'],
                    timeout=20000
                )
            except Exception as error:
                diagnostics = page.locator('#world').evaluate("""(canvas, eventId) => {
                  const sheet = document.querySelector('#sheet');
                  const button = document.querySelector('#interact-button');
                  const control = document.querySelector(
                    '[data-town-square-review-control="' + eventId + '"]'
                  );
                  return {
                    navigationTargetId: canvas.dataset.navigationTargetId || null,
                    navigationState: canvas.dataset.navigationState || null,
                    movementEnabled: canvas.dataset.movementEnabled || null,
                    nearbyPlayerName: canvas.dataset.nearbyPlayerName || null,
                    nearbyNpcRole: canvas.dataset.nearbyNpcRole || null,
                    nearbyInstitutionId: canvas.dataset.nearbyInstitutionId || null,
                    sheetHidden: sheet?.hidden ?? null,
                    sheetTitle: document.querySelector('#sheet-title')?.textContent ?? null,
                    interactButtonHidden: button?.hidden ?? null,
                    interactButtonLabel: button?.getAttribute('aria-label') ?? null,
                    controlHidden: control?.hidden ?? null,
                    controlPointerType: control?.dataset.testPointerType ?? null,
                    markerCount: canvas.dataset.townSquareReviewVisibleCount || null,
                    markerObjects: canvas.dataset.townSquareReviewObjects || null,
                    eventId
                  };
                }""", review_event['id'])
                screenshot = Path(out) / f'town-square-{label.lower()}-{width}px-control-tap-failure.png'
                page.screenshot(path=str(screenshot), full_page=True)
                raise AssertionError(
                    label + ' map-object touch control did not route to or open the exact Chronicle event: ' +
                    json.dumps(diagnostics, sort_keys=True)
                ) from error
            if page.locator('#sheet').is_hidden():
                page.wait_for_function(
                    """expected => {
                      const world = document.querySelector('#world');
                      return world?.dataset.navigationTargetId === expected &&
                        world?.dataset.navigationState === 'arrived' &&
                        document.querySelector('#sheet')?.hidden === true;
                    }""",
                    arg=review_event['id'],
                    timeout=90000
                )
                arrived = read_shared_state(page)['world']
                if arrived['revision'] != before['revision'] or arrived['xp'] != before['xp'] or \
                        [event['id'] for event in arrived['events']] != [event['id'] for event in before['events']] or \
                        arrived['creations'] != before['creations']:
                    raise AssertionError(label + ' navigation to the review object must remain read-only and XP-neutral.')
                inspect_button = page.locator('#interact-button')
                expect(inspect_button).to_be_visible()
                expect(inspect_button).to_have_attribute(
                    'aria-label', 'Inspect retained TownSquare process review in World Chronicle'
                )
                inspect_button.tap()
            page.wait_for_function(
                """() => document.querySelector('#sheet')?.hidden === false &&
                  document.querySelector('#sheet-title')?.textContent === 'World Chronicle'""",
                timeout=20000
            )
            exact = page.locator('#sheet-content [data-event-id="world:' + review_event['id'] + '"]')
            expect(exact).to_have_count(1)
            expect(exact).to_have_attribute('data-event-source', 'world')
            expect(exact).to_contain_text(review_note)
            after = read_shared_state(page)['world']
            if after['revision'] != before['revision'] or after['xp'] != before['xp'] or \
                    [event['id'] for event in after['events']] != [event['id'] for event in before['events']] or \
                    after['creations'] != before['creations']:
                raise AssertionError(label + ' map-object inspection must be read-only and XP-neutral.')
            page.locator('#sheet-close').tap()
            return pointer_type

        founder_pointer_type = inspect_town_square_review_map_object(founder_page, 'Founder')
        reporter_pointer_type = inspect_town_square_review_map_object(reporter_page, 'reporter')

        def open_quest_board(page):
            if page.locator('#sheet').is_visible():
                page.locator('#sheet-close').tap()
            page.locator('#places-button').tap()
            route = page.get_by_role('button', name='Walk to Quest Board', exact=True)
            expect(route).to_be_visible()
            route.tap()
            enter_nearby_institution(page, 'quest_board', 'Quest Board', 'Quest Board')

        # The review is a real Founder-only institutional objective. Its evidence
        # must be the exact retained event, and Chronicle inspection must be read-only.
        open_quest_board(founder_page)
        founder_quest_content = founder_page.locator('#sheet-content')
        expect(founder_quest_content).to_have_attribute('data-quest-board', 'true')
        expect(founder_quest_content).to_have_attribute('data-actor-role', 'founder')
        review_objective = founder_quest_content.locator(
            '[data-objective-id="founder-commons-report-review"]'
        )
        expect(review_objective).to_have_count(1)
        expect(review_objective).to_contain_text(
            'Record a process review for another actor’s Commons report'
        )
        expect(review_objective).to_contain_text('1/1')
        expect(review_objective).to_contain_text('3 retained events')
        expect(review_objective.locator('.quest-step-state')).to_have_text('RECORDED')
        expect(review_objective.get_by_role(
            'button', name='Walk to The Commons at TownSquare →', exact=True
        )).to_have_count(0)

        evidence_details = review_objective.locator('details.quest-evidence')
        expect(evidence_details).to_have_count(1)
        evidence_details.locator('summary').tap()
        expect(evidence_details.locator('[data-quest-evidence-event-link]')).to_have_count(3)
        for source_event in source_chain:
            source_link = evidence_details.locator(
                '[data-quest-evidence-event-link="' + source_event['id'] + '"]'
            )
            expect(source_link).to_have_count(1)
            expect(source_link).to_have_attribute('data-chronicle-event-id', source_event['id'])
            expect(source_link).to_have_attribute('data-chronicle-source', 'world')
            expect(source_link).to_have_attribute(
                'aria-label',
                'Inspect retained ' + source_event['type'] + ' event in World Chronicle'
            )
        event_link = evidence_details.locator(
            '[data-quest-evidence-event-link="' + review_event['id'] + '"]'
        )
        board_revision = founder_quest_content.get_attribute(
            'data-quest-board-snapshot-revision'
        )
        if not isinstance(board_revision, str) or not board_revision.isdigit():
            raise AssertionError('The Founder Quest Board must expose its accepted snapshot revision.')
        founder_quest_layout = founder_page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth
        })""")
        if founder_quest_layout['documentWidth'] > founder_quest_layout['viewportWidth'] + 1:
            raise AssertionError('Founder Quest Board caused horizontal overflow: ' + json.dumps(founder_quest_layout))
        founder_quest_screenshot = out / ('town-square-founder-review-quest-' + str(width) + '.png')
        founder_page.screenshot(path=str(founder_quest_screenshot), full_page=True)

        before_chronicle = read_shared_state(founder_page)['world']
        event_link.tap()
        expect(founder_page.locator('#sheet-title')).to_have_text('World Chronicle')
        exact_review_event = founder_page.locator(
            '#sheet-content [data-event-id="world:' + review_event['id'] + '"]'
        )
        expect(exact_review_event).to_have_count(1)
        expect(exact_review_event).to_have_attribute('data-event-source', 'world')
        expect(exact_review_event).to_contain_text(review_note)
        expect(founder_page.locator('#sheet-content')).to_have_attribute(
            'data-chronicle-snapshot-revision', board_revision
        )
        after_chronicle = read_shared_state(founder_page)['world']
        if after_chronicle['revision'] != before_chronicle['revision'] or \
                after_chronicle['xp'] != before_chronicle['xp'] or \
                [event['id'] for event in after_chronicle['events']] != [
                    event['id'] for event in before_chronicle['events']
                ] or after_chronicle['creations'] != before_chronicle['creations']:
            raise AssertionError('Quest evidence and Chronicle inspection must not mutate the world.')
        founder_chronicle_layout = founder_page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth
        })""")
        if founder_chronicle_layout['documentWidth'] > founder_chronicle_layout['viewportWidth'] + 1:
            raise AssertionError('Founder World Chronicle caused horizontal overflow: ' + json.dumps(founder_chronicle_layout))
        founder_chronicle_screenshot = out / ('town-square-founder-review-chronicle-' + str(width) + '.png')
        founder_page.screenshot(path=str(founder_chronicle_screenshot), full_page=True)

        open_quest_board(reporter_page)
        reporter_quest_content = reporter_page.locator('#sheet-content')
        expect(reporter_quest_content).to_have_attribute('data-quest-board', 'true')
        expect(reporter_quest_content).to_have_attribute('data-actor-role', 'witness')
        expect(reporter_quest_content.locator(
            '[data-objective-id="founder-commons-report-review"]'
        )).to_have_count(0)
        reporter_review_objective = reporter_quest_content.locator(
            '[data-objective-id="witness-commons-report-review-received"]'
        )
        expect(reporter_review_objective).to_have_count(1)
        expect(reporter_review_objective).to_contain_text('1/1')
        expect(reporter_review_objective).to_contain_text('3 retained events')
        expect(reporter_review_objective.locator('.quest-step-state')).to_have_text('RECORDED')
        reporter_evidence_details = reporter_review_objective.locator('details.quest-evidence')
        expect(reporter_evidence_details).to_have_count(1)
        reporter_evidence_details.locator('summary').tap()
        expect(reporter_evidence_details.locator('[data-quest-evidence-event-link]')).to_have_count(3)
        for source_event in source_chain:
            source_link = reporter_evidence_details.locator(
                '[data-quest-evidence-event-link="' + source_event['id'] + '"]'
            )
            expect(source_link).to_have_count(1)
            expect(source_link).to_have_attribute('data-chronicle-event-id', source_event['id'])
            expect(source_link).to_have_attribute('data-chronicle-source', 'world')
            expect(source_link).to_have_attribute(
                'aria-label',
                'Inspect retained ' + source_event['type'] + ' event in World Chronicle'
            )
        reporter_event_link = reporter_evidence_details.locator(
            '[data-quest-evidence-event-link="' + review_event['id'] + '"]'
        )
        reporter_board_revision = reporter_quest_content.get_attribute(
            'data-quest-board-snapshot-revision'
        )
        if not isinstance(reporter_board_revision, str) or not reporter_board_revision.isdigit():
            raise AssertionError('The Witness Quest Board must expose its accepted snapshot revision.')
        reporter_quest_layout = reporter_page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth
        })""")
        if reporter_quest_layout['documentWidth'] > reporter_quest_layout['viewportWidth'] + 1:
            raise AssertionError('Witness Quest Board caused horizontal overflow: ' + json.dumps(reporter_quest_layout))
        reporter_quest_screenshot = out / ('town-square-reporter-quest-board-' + str(width) + '.png')
        reporter_page.screenshot(path=str(reporter_quest_screenshot), full_page=True)

        before_reporter_chronicle = authoritative_snapshot(reporter_page)
        reporter_event_link.tap()
        expect(reporter_page.locator('#sheet-title')).to_have_text('World Chronicle')
        exact_reporter_review_event = reporter_page.locator(
            '#sheet-content [data-event-id="world:' + review_event['id'] + '"]'
        )
        expect(exact_reporter_review_event).to_have_count(1)
        expect(exact_reporter_review_event).to_have_attribute('data-event-source', 'world')
        expect(exact_reporter_review_event).to_contain_text(review_note)
        expect(reporter_page.locator('#sheet-content')).to_have_attribute(
            'data-chronicle-snapshot-revision', reporter_board_revision
        )
        after_reporter_chronicle = authoritative_snapshot(reporter_page)
        if after_reporter_chronicle != before_reporter_chronicle:
            raise AssertionError('Witness review-event Chronicle inspection must not mutate the accepted world.')
        reporter_chronicle_layout = reporter_page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth
        })""")
        if reporter_chronicle_layout['documentWidth'] > reporter_chronicle_layout['viewportWidth'] + 1:
            raise AssertionError('Witness World Chronicle caused horizontal overflow: ' + json.dumps(reporter_chronicle_layout))
        reporter_chronicle_screenshot = out / ('town-square-reporter-review-chronicle-' + str(width) + '.png')
        reporter_page.screenshot(path=str(reporter_chronicle_screenshot), full_page=True)

        if errors:
            raise AssertionError('Browser page errors: ' + json.dumps(errors))
        return {
            'journey': 'touch-town-square-report-review-' + str(width),
            'passed': True,
            'viewport': width,
            'actorsDistinct': True,
            'messageIds': [message_one_id, message_two_id],
            'reportIds': [report_one_id, report_two_id],
            'reviewId': review_event.get('reviewId'),
            'sourceChainEventIds': source_chain_ids,
            'lostResponseRequestId': lost_review_response['requestId'],
            'relayRecoveredIdempotently': True,
            'reviewRevisionDelta': 1,
            'reviewXpDelta': 0,
            'reporterSawExactReview': True,
            'authorAndUnrelatedSawNoPrivateReports': True,
            'founderSelfReviewBlocked': True,
            'messageVisibilityUnchanged': True,
            'moderationEvents': 0,
            'rejectedActionsMutated': False,
            'founderQuestReviewProgress': '1/1',
            'founderQuestReviewEventId': review_event['id'],
            'founderQuestChronicleNavigation': True,
            'questAndChronicleInspectionReadOnly': True,
            'reporterFounderObjectiveHidden': True,
            'reporterReviewProgress': '1/1',
            'reporterQuestReviewEventId': review_event['id'],
            'reporterQuestChronicleNavigation': True,
            'reporterChronicleReadOnly': True,
            'mapInputPointerType': reporter_pointer_type,
            'mapInputPointerTypes': {'founder': founder_pointer_type, 'reporter': reporter_pointer_type},
            'pageErrors': errors,
            'screenshots': [
                reporter_screenshot.name,
                founder_screenshot.name,
                founder_quest_screenshot.name,
                founder_chronicle_screenshot.name,
                reporter_quest_screenshot.name,
                reporter_chronicle_screenshot.name
            ]
        }
    finally:
        for context in reversed(contexts):
            context.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='/tmp/ngl-council-chamber')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--no-sandbox'])
        try:
            for width in (320, 390):
                # Each viewport receives an isolated world so the populated
                # fixture is independently exercised rather than replayed.
                with tempfile.TemporaryDirectory(prefix='ngl-council-mobile-' + str(width) + '-') as data_dir:
                    process, url = launch_server(data_dir)
                    try:
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

                        try:
                            result = run_town_square_report_review(browser, url, out, width)
                            results.append(result)
                            (out / 'results.json').write_text(json.dumps(results, indent=2))
                            print(json.dumps(result), flush=True)
                        except Exception as error:
                            results.append({
                                'journey': 'touch-town-square-report-review-' + str(width),
                                'passed': False,
                                'error': str(error)
                            })
                            (out / 'results.json').write_text(json.dumps(results, indent=2))
                            raise
                    finally:
                        stop_server(process)
        finally:
            browser.close()
    print(json.dumps(results))


if __name__ == '__main__':
    main()
