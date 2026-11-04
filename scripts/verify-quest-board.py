"""Mobile acceptance for the actor-scoped, in-world Quest Board.

The journey verifies that real retained publication activity changes the
Founder objective projection, while opening the board itself is read-only.
A rotated Witness receives a different actor-scoped objective trail.
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
        creationVersions: world.creations.map(creation => [creation.id, creation.version]),
        viewerId: dto.viewer?.id,
        viewerRole: dto.viewer?.role
      };
    }""")


def publish_fixture(page):
    return page.evaluate("""async () => {
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
      const draft = await post({
        type: 'draft',
        kind: 'custom',
        title: 'Quest Board acceptance fixture',
        intent: 'A disposable browser fixture, not a truth claim.',
        html: '<main><h1>Fixture</h1><p>Not independent evidence.</p></main>',
        requestId: 'quest-board-fixture-draft'
      });
      const draftId = draft.result?.draftId;
      if (typeof draftId !== 'string') throw new Error('Fixture draft did not return a draft ID.');
      const publication = await post({
        type: 'publish',
        draftId,
        expectedVersion: 0,
        requestId: 'quest-board-fixture-publish'
      });
      if (typeof publication.result?.creationId !== 'string') {
        throw new Error('Fixture publication did not return a retained creation ID.');
      }
      return publication.result;
    }""")


def open_quest_board(page):
    page.locator('#places-button').tap()
    route = page.get_by_role('button', name='Walk to Quest Board', exact=True)
    expect(route).to_be_visible()
    route.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Quest Board' && "
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )


def assert_board(page, role):
    content = page.locator('#sheet-content')
    expect(page.locator('#sheet-title')).to_have_text('Quest Board')
    expect(content).to_have_attribute('data-quest-board', 'true')
    expect(content).to_have_attribute('data-actor-role', role)
    expect(content.locator('[data-quest-board-list]')).to_have_count(1)
    rows = content.locator('[data-objective-id]')
    assert rows.count() > 0, 'The board must render the current character objective trail.'
    text = content.inner_text().lower()
    assert 'retained event' in text
    assert 'does not certify truth, mastery' in text
    return rows


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
        # Shared entry is a Witness session. Authenticate through the local
        # service's real Founder login path before testing Founder objectives.
        page.locator('#login-button').tap()
        page.locator('#founder-name').fill('Damien')
        page.locator('#founder-key').fill('fake-browser-fixture-key-not-a-secret')
        page.locator('#verify-founder').tap()
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )

        if width == 390:
            fixture = publish_fixture(page)
            page.wait_for_function(
                "() => document.querySelector('#creation-count')?.textContent === '1' && "
                "document.querySelector('#xp-count')?.textContent === '100'"
            )
        else:
            fixture = None

        before = authoritative_snapshot(page)
        assert before['viewerRole'] == 'founder'
        open_quest_board(page)
        rows = assert_board(page, 'founder')
        founder_first = page.locator('#sheet-content [data-objective-id="founder-first-place"]')
        expect(founder_first).to_have_count(1)
        if fixture:
            expect(founder_first.locator('.quest-step-state')).to_have_text('RECORDED')
            expect(founder_first).to_contain_text('1/1')
        else:
            expect(founder_first.locator('.quest-step-state')).to_have_text('OPEN')
            expect(founder_first).to_contain_text('0/1')
            action = founder_first.get_by_role('button', name='Go do this →', exact=True)
            expect(action).to_be_visible()
            action.tap()
            expect(page.locator('#sheet-title')).to_have_text('Give an idea a place.')
            expect(page.locator('#sheet-kicker')).to_have_text('THE MAKING BENCH')
            page.locator('#sheet-close').tap()
            expect(page.locator('#sheet')).to_be_hidden()
            page.locator('#interact-button').tap()
            page.wait_for_function(
                "() => document.querySelector('#sheet-title')?.textContent === 'Quest Board'",
                timeout=10000
            )
            assert_board(page, 'founder')

        after = authoritative_snapshot(page)
        assert after == before, (
            'Opening, reading, or routing from the Quest Board must not append events, '
            'change the canonical revision, award XP, or create artifacts.'
        )
        expect(page.locator('#xp-count')).to_have_text(str(before['xp']))
        expect(page.locator('#creation-count')).to_have_text(str(len(before['creationVersions'])))

        witness_result = None
        if width == 390:
            page.locator('#sheet-close').tap()
            expect(page.locator('#sheet')).to_be_hidden()
            rotated = page.evaluate("""async () => {
              const response = await fetch('/api/logout', {
                method: 'POST',
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({})
              });
              if (!response.ok) throw new Error('Witness session rotation failed: ' + response.status);
              return (await response.json()).viewer;
            }""")
            assert rotated['role'] == 'witness'
            page.reload(wait_until='networkidle')
            page.locator('#start-shared').tap()
            page.locator('#world').wait_for(state='visible')
            page.wait_for_function(
                "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
            )
            witness_before = authoritative_snapshot(page)
            assert witness_before['viewerRole'] == 'witness'
            open_quest_board(page)
            witness_rows = assert_board(page, 'witness')
            founder_rows = page.locator('#sheet-content [data-objective-id^="founder-"]')
            witness_objectives = page.locator('#sheet-content [data-objective-id^="witness-"]')
            assert founder_rows.count() == 0, 'A Witness must not receive Founder objectives.'
            assert witness_objectives.count() > 0, 'A Witness must receive the Witness objective trail.'
            witness_after = authoritative_snapshot(page)
            assert witness_after == witness_before, (
                'The Witness board is also a read-only projection of the shared world.'
            )
            witness_result = {
                'viewerRole': witness_before['viewerRole'],
                'founderObjectivesHidden': True,
                'witnessObjectivesVisible': True,
                'worldStateUnchanged': True
            }

        layout = page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          sheetWidth: document.querySelector('#sheet').clientWidth
        })""")
        assert layout['documentWidth'] <= layout['viewportWidth'] + 1, (
            'Quest Board caused horizontal page overflow: ' + json.dumps(layout)
        )
        assert not errors, 'Browser page errors: ' + json.dumps(errors)
        screenshot = out / ('quest-board-' + str(width) + '.png')
        page.screenshot(path=str(screenshot), full_page=True)
        return {
            'journey': 'touch-quest-board-' + str(width),
            'passed': True,
            'viewport': width,
            'founderRole': before['viewerRole'],
            'objectiveCount': rows.count(),
            'fixturePublication': fixture,
            'recordedFounderObjective': bool(fixture),
            'boardInspectionReadOnly': True,
            'worldRevision': before['revision'],
            'worldXp': before['xp'],
            'eventCount': len(before['eventIds']),
            'creationCount': len(before['creationVersions']),
            'witness': witness_result,
            'pageErrors': errors,
            'screenshot': screenshot.name
        }
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='/tmp/ngl-quest-board-mobile')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='ngl-quest-board-mobile-') as data_dir:
        process, url = launch_server(data_dir)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=['--no-sandbox'])
                try:
                    for width in (320, 390):
                        result = run_viewport(browser, url, out, width)
                        results.append(result)
                        (out / 'results.json').write_text(json.dumps(results, indent=2))
                        print(json.dumps(result), flush=True)
                finally:
                    browser.close()
        finally:
            stop_server(process)
    print(json.dumps(results))


if __name__ == '__main__':
    main()
