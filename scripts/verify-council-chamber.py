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


def open_town_square(page):
    if not page.locator('#sheet').is_hidden():
        page.locator('#sheet-close').tap()
    page.locator('#places-button').tap()
    route = page.get_by_role('button', name='Walk to The Commons at TownSquare', exact=True)
    expect(route).to_be_visible()
    route.tap()
    page.wait_for_function(
        """() => document.querySelector('#world')?.dataset.nearbyInstitutionId === 'town-square' &&
          document.querySelector('#sheet')?.hidden === true""",
        timeout=90000
    )
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
        founder_page.wait_for_function(
            """async () => {
              const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
              if (!response.ok) return false;
              const dto = await response.json();
              return dto.viewer?.role === 'founder';
            }""",
            timeout=15000
        )
        founder = read_shared_state(founder_page)['viewer']
        if len({author['id'], reporter['id'], unrelated['id'], founder['id']}) != 4:
            raise AssertionError('Author, reporter, unrelated Witness and Founder must be distinct actors.')
        if founder.get('role') != 'founder' or any(
            actor.get('role') != 'witness' for actor in (author, reporter, unrelated)
        ):
            raise AssertionError('Only the authenticated Founder session may review Commons reports.')

        # Enter through the map's TownSquare route and its explicit nearby Interact action.
        open_town_square(reporter_page)
        open_town_square(founder_page)

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
        reporter_before_review = read_shared_state(reporter_page)
        if founder_before_review['world']['xp'] != reporter_before_review['world']['xp']:
            raise AssertionError('Posting and reporting Commons messages must not create XP.')
        revision_before = founder_before_review['world']['revision']
        xp_before = founder_before_review['world']['xp']
        event_ids_before = [event['id'] for event in founder_before_review['world']['events']]

        review_note = 'Reviewed as a process step; this note is not a factual verdict or moderation action.'
        report_item = founder_page.locator('[data-commons-pending-report="' + report_one_id + '"]')
        expect(report_item).to_be_visible()
        report_item.locator('summary').tap()
        founder_page.locator('[id="commons-review-note-' + report_one_id + '"]').fill(review_note)
        founder_page.locator('[data-commons-review="' + report_one_id + '"]').tap()
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
                review_event.get('actor', {}).get('role') != 'founder':
            raise AssertionError('The exact review event must retain report, message, note and Founder identity.')
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
        if any(event.get('type') == 'message-moderated' for event in founder_events):
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

        if errors:
            raise AssertionError('Browser page errors: ' + json.dumps(errors))

        reporter_screenshot = out / ('town-square-reporter-review-' + str(width) + '.png')
        founder_screenshot = out / ('town-square-founder-review-' + str(width) + '.png')
        reporter_page.screenshot(path=str(reporter_screenshot), full_page=True)
        founder_page.screenshot(path=str(founder_screenshot), full_page=True)
        return {
            'journey': 'touch-town-square-report-review-' + str(width),
            'passed': True,
            'viewport': width,
            'actorsDistinct': True,
            'messageIds': [message_one_id, message_two_id],
            'reportIds': [report_one_id, report_two_id],
            'reviewId': review_event.get('reviewId'),
            'reviewRevisionDelta': 1,
            'reviewXpDelta': 0,
            'reporterSawExactReview': True,
            'authorAndUnrelatedSawNoPrivateReports': True,
            'founderSelfReviewBlocked': True,
            'messageVisibilityUnchanged': True,
            'moderationEvents': 0,
            'rejectedActionsMutated': False,
            'pageErrors': errors,
            'screenshots': [reporter_screenshot.name, founder_screenshot.name]
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
