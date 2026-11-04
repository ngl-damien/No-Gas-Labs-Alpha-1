"""Touch-first acceptance for the walkable Council Chamber on narrow phones.

This is a focused real-browser journey, separate from the shared browser suite:
a mobile player routes through the world to the Council Chamber, then explicitly
interacts with the landmark. Opening the room must remain a read-only projection.
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

        # Re-open through the in-world interaction control after arrival. This
        # distinguishes an accessible route from a decorative list entry.
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
            'roleCards': 4,
            'pendingRoles': 4,
            'revision': before['revision'],
            'xp': before['xp'],
            'events': len(before['eventIds']),
            'creations': len(before['creationVersions']),
            'worldStateUnchanged': True,
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
