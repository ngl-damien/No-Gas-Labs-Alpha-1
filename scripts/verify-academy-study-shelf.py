"""Mobile acceptance for the actor-scoped Study Card shelf inside the Polymath Academy.

The journey creates a real retained publication through the shared service, records
one Witness study note through the in-world Academy form, and verifies that the
resulting card is visible only to its author. Opening the shelf/source is read-only.
"""
import argparse
import json
import select
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FOUNDER_KEY = 'fake-browser-fixture-key-not-a-secret'
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


def read_state(page):
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
        viewer: { id: dto.viewer.id, role: dto.viewer.role },
        revision: world.revision,
        xp: world.xp,
        eventIds: world.events.map(event => event.id),
        creationVersions: world.creations.map(creation => [creation.id, creation.version]),
        studyEvents: world.events.filter(event => event.type === 'study').map(event => ({
          id: event.id,
          actorId: event.actor && event.actor.id,
          actorRole: event.actor && event.actor.role,
          creationId: event.creationId,
          version: event.version
        }))
      };
    }""")


def create_published_source_as_founder(page):
    return page.evaluate("""async founderKey => {
      const loginResponse = await fetch('/api/login', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: founderKey, name: 'Damien' })
      });
      const login = await loginResponse.json();
      if (!loginResponse.ok || login.viewer?.role !== 'founder') {
        throw new Error('Founder fixture login failed: ' + JSON.stringify(login));
      }
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
          'Founder fixture action ' + action.type + ' failed (' + response.status + '): ' + JSON.stringify(payload)
        );
        return payload;
      };
      const draft = await post({
        type: 'draft',
        kind: 'observatory',
        title: 'Academy Study Shelf Source',
        intent: 'A retained publication for a source-bound Academy practice journey.',
        requestId: 'academy-shelf-founder-draft'
      });
      const draftId = draft.result?.draftId;
      if (typeof draftId !== 'string') throw new Error('Founder draft did not return a draft ID.');
      const publication = await post({
        type: 'publish',
        draftId,
        expectedVersion: 0,
        requestId: 'academy-shelf-founder-publish'
      });
      const creationId = publication.result?.creationId;
      if (typeof creationId !== 'string') throw new Error('Founder publication did not return a creation ID.');
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Published state read failed: ' + response.status);
      const dto = await response.json();
      const creation = dto.world.creations.find(item => item.id === creationId);
      if (!creation || creation.version !== 1) throw new Error('The exact published source version was not retained.');
      return {
        founderId: login.viewer.id,
        creationId,
        title: creation.title,
        revision: dto.world.revision,
        xp: dto.world.xp
      };
    }""", FOUNDER_KEY)


def rotate_to_witness(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error('Founder logout/Witness rotation failed: ' + response.status);
      const dto = await response.json();
      return dto.viewer;
    }""")


def enter_shared_world(page):
    page.locator('#start-shared').tap()
    page.locator('#world').wait_for(state='visible')
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
    )



def enter_nearby_institution(page, place_id, accessible_name, title, timeout=30000):
    page.bring_to_front()
    try:
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
    except Exception as error:
        diagnostics = page.evaluate("""async () => {
          let viewer = null;
          try {
            const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
            if (response.ok) {
              const dto = await response.json();
              viewer = { id: dto.viewer?.id ?? null, role: dto.viewer?.role ?? null, position: dto.viewer?.position ?? null };
            }
          } catch {}
          const world = document.querySelector('#world');
          const button = document.querySelector('#interact-button');
          return {
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
            modeLabel: document.querySelector('#mode-label')?.textContent ?? null,
            connectionState: document.querySelector('#connection-dot')?.dataset.connectionState ?? null,
            nearbyInstitutionId: world?.dataset.nearbyInstitutionId ?? null,
            interactLabel: button?.getAttribute('aria-label') ?? null,
            sheetHidden: document.querySelector('#sheet')?.hidden ?? null,
            sheetTitle: document.querySelector('#sheet-title')?.textContent ?? null,
            viewer
          };
        }""")
        raise AssertionError(
            f"Could not reach {accessible_name} ({place_id}) within {timeout}ms: " +
            json.dumps(diagnostics)
        ) from error
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

def wait_for_nearby_npc(page, role_id, npc_id, name, timeout=30000):
    page.bring_to_front()
    aria_label = 'Talk to nearby collaborator ' + name
    try:
        page.wait_for_function(
            """expected => {
                const world = document.querySelector('#world');
                const sheet = document.querySelector('#sheet');
                const button = document.querySelector('#interact-button');
                return world?.dataset.nearbyNpcRole === expected.roleId &&
                    world?.dataset.navigationTargetId === expected.npcId &&
                    world?.dataset.navigationState === 'arrived' &&
                    sheet?.hidden === true &&
                    button && !button.hidden &&
                    button.getAttribute('aria-label') === expected.ariaLabel;
            }""",
            arg={'roleId': role_id, 'npcId': npc_id, 'ariaLabel': aria_label},
            timeout=timeout
        )
    except Exception as error:
        diagnostics = page.evaluate("""() => {
          const world = document.querySelector('#world');
          const button = document.querySelector('#interact-button');
          return {
            navigationTargetId: world?.dataset.navigationTargetId ?? null,
            navigationState: world?.dataset.navigationState ?? null,
            nearbyNpcRole: world?.dataset.nearbyNpcRole ?? null,
            interactLabel: button?.getAttribute('aria-label') ?? null,
            interactHidden: button?.hidden ?? null,
            sheetHidden: document.querySelector('#sheet')?.hidden ?? null
          };
        }""")
        raise AssertionError(
            'Player did not reach the explicit Interact prompt for ' + name + ': ' + json.dumps(diagnostics)
        ) from error


def open_academy(page):
    page.bring_to_front()
    page.locator('#places-button').tap()
    page.get_by_role('button', name='Walk to Polymath Academy', exact=True).tap()
    enter_nearby_institution(page, 'academy', 'Polymath Academy', 'Polymath Academy')
    shelf = page.locator('[data-study-card-collection="academy-study-shelf"]')
    expect(shelf).to_have_count(1)
    return shelf


def run_viewport(browser, url, out, width):
    context = browser.new_context(
        viewport={'width': width, 'height': 900},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True
    )
    other_context = None
    errors = []
    try:
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url, wait_until='networkidle')
        enter_shared_world(page)
        initial = read_state(page)
        assert initial['viewer']['role'] == 'witness', 'Shared arrivals must begin as Witness.'
        publication = create_published_source_as_founder(page)
        assert publication['founderId'] == 'damien'
        assert publication['title'] == 'Academy Study Shelf Source'

        # Re-enter after the Founder session was established, then return to a
        # fresh Witness identity before recording the study note.
        page.reload(wait_until='networkidle')
        enter_shared_world(page)
        founder_state = read_state(page)
        assert founder_state['viewer']['role'] == 'founder', 'The published source must be Founder-authored.'
        assert founder_state['xp'] == publication['xp']

        witness = rotate_to_witness(page)
        assert witness['role'] == 'witness' and witness['id'] != publication['founderId']
        page.reload(wait_until='networkidle')
        enter_shared_world(page)
        before_study = read_state(page)
        assert before_study['viewer']['role'] == 'witness'
        assert before_study['viewer']['id'] == witness['id']

        shelf = open_academy(page)
        codex = page.locator('[data-charter-codex]')
        expect(codex).to_have_count(1)
        expect(codex.locator('summary')).to_contain_text('AOTA CODEX')
        expect(codex.locator('[data-charter-stage]')).to_have_count(12)
        assert codex.evaluate('(node) => node.open') is False, 'The Codex should be collapsed until the player opens it.'
        codex_before = read_state(page)
        codex.locator('summary').tap()
        expect(codex).to_contain_text('The-NEOPHYTE_FOUNDER + idea + multiple AI collaborators')
        expect(codex).to_contain_text('A model’s assertion is never sufficient evidence')
        expect(codex.locator('[data-charter-stage="engineer-for-use"]')).to_contain_text(
            'NOT REPRESENTED IN PLAYER-WORLD STATE'
        )
        expect(codex.locator('[data-charter-stage="deploy-share-commercialize"]')).to_contain_text(
            'NOT REPRESENTED IN PLAYER-WORLD STATE'
        )
        charter_statuses = codex.locator('.status-line').all_text_contents()
        assert not any(
            any(label in status for label in ('COMPLETE', 'APPROVED', 'VERIFIED'))
            for status in charter_statuses
        ), 'Charter activity labels must not manufacture completion, approval or verification.'
        codex_after = read_state(page)
        assert codex_after['revision'] == codex_before['revision']
        assert codex_after['xp'] == codex_before['xp']
        assert codex_after['eventIds'] == codex_before['eventIds'], (
            'Opening the AOTA Codex must not append a canonical event.'
        )
        expect(shelf.locator('[data-study-card]')).to_have_count(0)
        expect(shelf).to_contain_text('No linked study attempts have been recorded for this character yet.')

        # Stage 10 must route to the named Synthesis Clerk NPC, not merely the
        # Guild Hall landmark. Arrival still requires the player's explicit Interact.
        stage10_action = codex.locator('[data-charter-stage-action="engineer-for-use"]')
        expect(stage10_action).to_be_visible()
        expect(stage10_action).to_contain_text('Inspect related room · Guild Hall · Synthesis Clerk')
        stage10_action.tap()
        page.wait_for_function("""() => {
          const world = document.querySelector('#world');
          return document.querySelector('#sheet')?.hidden === true &&
            world?.dataset.navigationTargetId === 'guild-npc-synthesizer' &&
            ['walking', 'arrived'].includes(world?.dataset.navigationState);
        }""", timeout=30000)
        wait_for_nearby_npc(page, 'synthesizer', 'guild-npc-synthesizer', 'Synthesis Clerk')
        before_clerk_interaction = read_state(page)
        assert before_clerk_interaction['viewer']['role'] == 'witness'
        assert before_clerk_interaction['xp'] == codex_before['xp'], (
            'Routing to the Synthesis Clerk must not award XP.'
        )
        page.locator('#interact-button').tap()
        page.wait_for_function("""() => {
          const sheet = document.querySelector('#sheet');
          const snapshot = document.querySelector('#sheet-content [data-project-state-snapshot="true"]');
          return sheet?.hidden === false &&
            document.querySelector('#sheet-title')?.textContent === 'Guild Hall' &&
            snapshot && snapshot.dataset.projectStateStatus !== 'loading';
        }""", timeout=30000)
        expect(page.locator('#sheet-kicker')).to_have_text('COUNCIL · CAPABILITIES · EVIDENCE')
        expect(page.locator('#sheet-content')).to_contain_text('SYNTHESIS CLERK · BOUNDED COLLABORATOR')
        expect(page.locator('#sheet-content')).to_contain_text(
            'The Synthesis Clerk can read the last public GitHub snapshot bundled with this build.'
        )
        clerk_snapshot = page.locator('#sheet-content [data-project-state-snapshot="true"]')
        expect(clerk_snapshot).to_have_attribute('aria-label', 'Bundled public GitHub project-state snapshot')
        clerk_snapshot_status = clerk_snapshot.get_attribute('data-project-state-status')
        assert clerk_snapshot_status in ('receipt-verified', 'unavailable'), (
            'The Synthesis Clerk snapshot must report a bounded receipt state, never an inferred success.'
        )
        if clerk_snapshot_status == 'receipt-verified':
            expect(clerk_snapshot).to_contain_text('SHA-256 RECEIPT MATCHED · NOT LIVE')
            expect(clerk_snapshot).to_contain_text('This identifies payload bytes only')
        else:
            expect(clerk_snapshot).to_contain_text('No project queue is inferred from an unavailable snapshot.')
        after_clerk_interaction = read_state(page)
        assert after_clerk_interaction['revision'] == before_clerk_interaction['revision']
        assert after_clerk_interaction['xp'] == before_clerk_interaction['xp']
        assert after_clerk_interaction['eventIds'] == before_clerk_interaction['eventIds'], (
            'Inspecting the Synthesis Clerk and its snapshot must not append canonical state.'
        )
        clerk_screenshot = out / ('academy-synthesis-clerk-' + str(width) + '.png')
        page.screenshot(path=str(clerk_screenshot), full_page=True)
        page.locator('#sheet-close').tap()

        # Stage 11 routes to the actual human-gated Decision Chamber. A Witness
        # can inspect its records but receives no APPROVE/REJECT/DEFER controls.
        shelf = open_academy(page)
        codex = page.locator('[data-charter-codex]')
        codex.locator('summary').tap()
        stage11_action = codex.locator('[data-charter-stage-action="deploy-share-commercialize"]')
        expect(stage11_action).to_be_visible()
        expect(stage11_action).to_contain_text('Inspect related room · Founder Gate · Decision Chamber')
        stage11_action.tap()
        page.wait_for_function("""() => {
          const world = document.querySelector('#world');
          return document.querySelector('#sheet')?.hidden === true &&
            world?.dataset.navigationTargetId === 'decision_chamber' &&
            ['walking', 'arrived'].includes(world?.dataset.navigationState);
        }""", timeout=30000)
        page.wait_for_function("""() => {
          const world = document.querySelector('#world');
          const sheet = document.querySelector('#sheet');
          const button = document.querySelector('#interact-button');
          return world?.dataset.nearbyInstitutionId === 'decision_chamber' &&
            world?.dataset.navigationTargetId === 'decision_chamber' &&
            world?.dataset.navigationState === 'arrived' &&
            sheet?.hidden === true &&
            button && !button.hidden &&
            button.getAttribute('aria-label') === 'Enter Founder Gate';
        }""", timeout=30000)
        before_decision_entry = read_state(page)
        assert before_decision_entry['viewer']['role'] == 'witness'
        assert before_decision_entry['xp'] == codex_before['xp'], (
            'Routing to Founder Gate must not award XP.'
        )
        page.locator('#interact-button').tap()
        page.wait_for_function("""() => {
          const sheet = document.querySelector('#sheet');
          return sheet?.hidden === false &&
            document.querySelector('#sheet-title')?.textContent === 'Decision Chamber' &&
            document.querySelector('#sheet-kicker')?.textContent === 'HUMAN GATE · DECISIONS';
        }""", timeout=30000)
        expect(page.locator('#sheet-content [data-witness-disposition-controls-withheld="true"]')).to_have_count(1)
        expect(page.locator('#sheet-content [data-gate-action]')).to_have_count(0)
        expect(page.locator('#sheet-content')).to_contain_text(
            'This server-reported readiness check is not a decision, evidence, approval, or authority grant.'
        )
        after_decision_entry = read_state(page)
        assert after_decision_entry['revision'] == before_decision_entry['revision']
        assert after_decision_entry['xp'] == before_decision_entry['xp']
        assert after_decision_entry['eventIds'] == before_decision_entry['eventIds'], (
            'Entering the Decision Chamber for inspection must not append a decision or approval.'
        )
        decision_screenshot = out / ('academy-decision-chamber-' + str(width) + '.png')
        page.screenshot(path=str(decision_screenshot), full_page=True)
        page.locator('#sheet-close').tap()
        shelf = open_academy(page)

        page.get_by_role('button', name='Record study note →', exact=True).tap()
        page.locator('#academy-study-question').fill(
            'What does the retained receipt establish?'
        )
        page.locator('#academy-study-attempt').fill(
            'It identifies the bytes, not whether the claim inside is true.'
        )
        page.locator('#academy-study-next-check').fill(
            'Find an independent observation that could challenge the claim.'
        )
        page.locator('#academy-study-submit').tap()
        page.wait_for_function("""() => {
          const shelf = document.querySelector('[data-study-card-collection="academy-study-shelf"]');
          return shelf && shelf.querySelectorAll('[data-study-card]').length === 1;
        }""", timeout=30000)

        state_after_study = read_state(page)
        assert state_after_study['revision'] == before_study['revision'] + 1, (
            'One retained study note should append exactly one canonical world event.'
        )
        assert state_after_study['xp'] == before_study['xp'], (
            'Study practice must not award XP.'
        )
        assert len(state_after_study['studyEvents']) == 1, (
            'The study note must be retained once, not duplicated.'
        )
        study_event = state_after_study['studyEvents'][0]
        assert study_event['actorId'] == state_after_study['viewer']['id']
        assert study_event['actorRole'] == 'witness'
        assert study_event['creationId'] == publication['creationId']
        assert study_event['version'] == 1

        shelf = page.locator('[data-study-card-collection="academy-study-shelf"]')
        expect(shelf).to_contain_text('ACADEMY STUDY SHELF · 1')
        expect(shelf.locator('[data-study-card]')).to_have_count(1)
        expect(shelf).to_contain_text('What does the retained receipt establish?')
        expect(shelf).to_contain_text('It identifies the bytes, not whether the claim inside is true.')
        expect(shelf).to_contain_text('Find an independent observation that could challenge the claim.')
        expect(shelf.locator('[data-study-card-open]')).to_have_count(1)
        screenshot = out / ('academy-study-shelf-' + str(width) + '.png')
        page.screenshot(path=str(screenshot), full_page=True)

        before_inspection = read_state(page)
        shelf.locator('[data-study-card-open]').tap()
        expect(page.locator('#sheet-title')).to_have_text('Academy Study Shelf Source')
        expect(page.locator('#version-select')).to_have_value('1')
        after_inspection = read_state(page)
        assert after_inspection['revision'] == before_inspection['revision']
        assert after_inspection['xp'] == before_inspection['xp']
        assert after_inspection['eventIds'] == before_inspection['eventIds'], (
            'Opening a Study Card must not append a canonical event.'
        )

        # A second independent Witness sees the retained note in history but
        # receives no card in their personal Academy shelf.
        other_context = browser.new_context(
            viewport={'width': width, 'height': 900},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True
        )
        other_page = other_context.new_page()
        other_page.set_default_timeout(15000)
        other_page.on('pageerror', lambda error: errors.append(str(error)))
        other_page.goto(url, wait_until='networkidle')
        enter_shared_world(other_page)
        other_shelf = open_academy(other_page)
        other_state = read_state(other_page)
        assert other_state['viewer']['role'] == 'witness'
        assert other_state['viewer']['id'] != state_after_study['viewer']['id']
        expect(other_shelf.locator('[data-study-card]')).to_have_count(0)
        expect(other_page.locator('#sheet-content')).to_contain_text(
            'What does the retained receipt establish?'
        )
        other_after = read_state(other_page)
        assert other_after['revision'] == after_inspection['revision']
        assert other_after['xp'] == after_inspection['xp']
        assert other_after['eventIds'] == after_inspection['eventIds']

        layout = page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          sheetWidth: document.querySelector('#sheet').clientWidth
        })""")
        assert layout['documentWidth'] <= layout['viewportWidth'] + 1, (
            'Academy Study Shelf caused horizontal page overflow: ' + json.dumps(layout)
        )
        assert not errors, 'Browser page errors: ' + json.dumps(errors)
        other_screenshot = out / ('academy-study-shelf-other-actor-' + str(width) + '.png')
        other_page.screenshot(path=str(other_screenshot), full_page=True)
        return {
            'journey': 'academy-study-shelf-' + str(width),
            'passed': True,
            'viewport': width,
            'sourceCreationId': publication['creationId'],
            'studyEventId': study_event['id'],
            'authorShelfCards': 1,
            'otherActorShelfCards': 0,
            'charterCodexStages': 12,
            'charterCodexReadOnly': True,
            'charterCodexCollapsedByDefault': True,
            'charterCodexUnsupportedStagesRemainUnrepresented': True,
            'charterCodexStage10RoutesToSynthesizerNpc': True,
            'synthesisClerkWorkbenchOpened': True,
            'synthesisSnapshotPanelStatus': clerk_snapshot_status,
            'synthesisClerkInspectionReadOnly': True,
            'charterCodexStage11RoutesToDecisionChamber': True,
            'decisionChamberWitnessControlsWithheld': True,
            'decisionChamberInspectionReadOnly': True,
            'retainedNoteVisibleToOtherActor': True,
            'studyAwardedNoXp': True,
            'sourceInspectionReadOnly': True,
            'eventHistoryUnchangedByInspection': True,
            'pageErrors': errors,
            'screenshots': [clerk_screenshot.name, decision_screenshot.name, screenshot.name, other_screenshot.name]
        }
    finally:
        if other_context is not None:
            other_context.close()
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='/tmp/ngl-academy-study-shelf')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--no-sandbox'])
        try:
            for width in (320, 390):
                with tempfile.TemporaryDirectory(prefix='ngl-academy-shelf-') as data_dir:
                    process, url = launch_server(data_dir)
                    try:
                        try:
                            result = run_viewport(browser, url, out, width)
                            results.append(result)
                            (out / 'results.json').write_text(json.dumps(results, indent=2))
                            print(json.dumps(result), flush=True)
                        except Exception as error:
                            results.append({
                                'journey': 'academy-study-shelf-' + str(width),
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
