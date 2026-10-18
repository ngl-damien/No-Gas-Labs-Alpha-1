"""Bounded real Chromium acceptance for institution records and the local Founder Gate.

Uses only a disposable localhost service and an explicitly fake Founder key. The
report is supplied by the caller; synthetic runs require --synthetic and must not
be presented as experimental evidence. Screenshots intentionally include the
artificial private evaluation, containing only a fake marker and supplied report.
"""
import argparse
import hashlib
import json
import math
import select
import subprocess
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY = 'fake-institution-browser-fixture-key-not-a-secret'
PRIVATE = 'PRIVATE_BROWSER_FIXTURE_EVALUATION'
DECISION_ID = 'browser-fixture-decision'
SERVER = """import {readFile} from 'node:fs/promises';
import {createGameServer} from './game/server.mjs';
const institutionReport=JSON.parse(await readFile(process.argv[2],'utf8'));
const server=await createGameServer({dataDir:process.argv[1],institutionReport,
  founderKey:'fake-institution-browser-fixture-key-not-a-secret'});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.once('SIGTERM',async()=>{await server.closeGame();});"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def launch_server(directory, report):
    process = subprocess.Popen(
        ['node', '--input-type=module', '-e', SERVER, str(directory), str(report)],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if not select.select([process.stdout], [], [], 15)[0]:
        process.terminate()
        process.wait(timeout=10)
        raise AssertionError('Disposable institution server failed readiness')
    line = process.stdout.readline()
    if not line:
        raise AssertionError('Disposable institution server startup: ' + process.stderr.read())
    return process, f'http://127.0.0.1:{json.loads(line)["port"]}/'


def stop_server(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise AssertionError('Disposable service failed graceful shutdown')
    assert process.returncode == 0, 'Disposable service exited unsuccessfully'


def close_sheet(page):
    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').click()


def start_shared(page, url):
    page.goto(url, wait_until='domcontentloaded')
    page.locator('#start-shared').click()
    expect(page.locator('#mode-label')).to_contain_text('Witness')


def institution(page):
    close_sheet(page)
    page.locator('#journal-button').click()
    page.locator('#institution-projects').click()
    expect(page.locator('#sheet-kicker')).to_have_text('PROJECTS · EVIDENCE · FOUNDER GATE')
    page.get_by_role('heading', name='FOUNDER GATE', exact=True).wait_for()


def login(page):
    close_sheet(page)
    page.locator('#login-button').click()
    page.locator('#founder-key').fill(KEY)
    page.locator('#verify-founder').click()
    expect(page.locator('#mode-label')).to_contain_text('Founder')


def no_overflow(page):
    dimensions = page.evaluate("""() => ({
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      sheet: {client: document.querySelector('#sheet').clientWidth,
              scroll: document.querySelector('#sheet').scrollWidth}
    })""")
    assert dimensions['document'] <= dimensions['viewport'], dimensions
    assert dimensions['sheet']['scroll'] <= dimensions['sheet']['client'] + 1, dimensions
    return dimensions


def post(context, url, route, payload, status=200):
    response = context.request.post(url + route, data=payload,
                                    headers={'Origin': url.rstrip('/')})
    assert response.status == status, f'{route}: expected {status}, got {response.status}: {response.text()[:1000]}'
    value = response.json()
    if status == 403:
        assert value['error']['code'] == 'FORBIDDEN', 'The expected host-authority denial did not execute'
    return value


def records(page, report):
    container = page.locator('#sheet-content')
    expect(container.locator('[data-record-type="PROJECTS"]')).to_have_count(1)
    expect(container.locator('[data-record-type="ACCOMPLISHMENTS"]')).to_have_count(2)
    expect(container.locator('[data-record-type="DISPUTES"]')).to_have_count(len(report['contradictions']))
    expect(container.locator('[data-record-type="DECISION STATUS"]')).to_have_count(1)
    expect(container.locator('[data-record-type="ACCOMPLISHMENTS"]')).to_contain_text([report['tasks']['A']['title'], report['tasks']['B']['title']])
    expect(container).to_contain_text('AWAITING_OPERATIONAL_GATE')
    expect(container).to_contain_text('These records do not award game XP.')
    expect(container).to_contain_text('External Witness participation: UNVERIFIED')


def witness_redacted(page, context, url):
    gate = context.request.get(url + 'api/decisions').json()
    encoded = json.dumps(gate)
    assert PRIVATE not in encoded and 'evaluation' not in encoded
    assert 'proposedEffect' not in encoded and 'rollback' not in encoded and 'risks' not in encoded
    assert page.locator('[data-gate-action]').count() == 0
    assert PRIVATE not in page.locator('body').text_content()
    assert page.get_by_text('Retained evaluation bytes', exact=True).count() == 0
    return gate


def unchanged_game(context, url):
    state = context.request.get(url + 'api/state').json()
    assert state['world']['xp'] == 0 and state['world']['creations'] == []
    assert state['institution']['kernel']['accepted'] == []
    return {'xp': state['world']['xp'], 'creations': len(state['world']['creations']),
            'kernelAccepted': len(state['institution']['kernel']['accepted'])}


def run(args, result):
    report_path = Path(args.report).resolve()
    report_bytes = report_path.read_bytes()
    report = json.loads(report_bytes)
    assert report['schema'] == 'ngl.compounding-experiment.v1'
    assert report['contradictions'], 'Acceptance requires at least one retained dispute'
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    result.update({
        'schema': 'ngl.institution-browser-acceptance.v1',
        'recordedAt': datetime.now(timezone.utc).isoformat(),
        'report': {'path': str(report_path), 'sha256': sha256(report_bytes),
                   'id': report['id'], 'kind': 'SYNTHETIC_FIXTURE' if args.synthetic else 'SUPPLIED_EXPERIMENT_REPORT',
                   'classification': report.get('classification')},
        'scope': 'Actual local Chromium and disposable server data; fake key and synthetic Gate policy/proposal only. No operational policy, live HTTPS Gate, production promotion or external Witness participation is established.',
        'sourceHashes': {name: sha256((ROOT / name).read_bytes()) for name in [
            'game/server.mjs', 'game/client.mjs', 'game/world-view.mjs', 'game/institution-view.mjs',
            'game/styles.css', 'src/institution/decisions.mjs', 'src/institution/project-projection.mjs',
            'scripts/verify-institution-browser.py']},
        'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip(),
        'journeys': [], 'screenshots': [], 'pageErrors': [], 'externalRequests': [],
    })
    pages = []

    def record(name, **details):
        result['journeys'].append({'journey': name, 'passed': True, **details})
        (out / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result['journeys'][-1]), flush=True)

    def attach(context, label):
        page = context.new_page()
        pages.append((label, page))
        page.on('pageerror', lambda error: result['pageErrors'].append({'page': label, 'error': str(error)}))
        page.on('request', lambda request: result['externalRequests'].append(request.url)
                if request.url.startswith(('http:', 'https:')) and not request.url.startswith('http://127.0.0.1:') else None)
        return page

    def screenshot(page, name):
        page.screenshot(path=str(out / name))
        result['screenshots'].append(name)

    with tempfile.TemporaryDirectory(prefix='ngl-institution-browser-') as data:
        process, url = launch_server(data, report_path)
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            except Exception:
                stop_server(process)
                raise
            result['chromiumVersion'] = browser.version
            try:
                witness = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True,
                                              has_touch=True, reduced_motion='reduce')
                owner = browser.new_context(viewport={'width': 1440, 'height': 1000})
                w, a = attach(witness, 'witness-phone'), attach(owner, 'founder-desktop')
                start_shared(w, url)
                institution(w)
                records(w, report)
                initial = witness_redacted(w, witness, url)
                assert initial['policy'] is None and initial['decisions'] == []
                expect(w.locator('#sheet-content')).to_contain_text('No operational review policy is activated.')
                expect(w.locator('#sheet-content')).to_contain_text('The first 24-hour clock has not started.')
                screenshot(w, 'witness-phone-records.png')
                record('fresh-witness-report-projection', projects=1, accomplishments=2,
                       disputes=len(report['contradictions']), awaitingOperationalGate=True,
                       defaultPolicy=None, game=unchanged_game(witness, url), viewport=no_overflow(w))

                positions = []
                def position_request(request):
                    if request.url.endswith('/api/presence') and request.method == 'POST':
                        positions.append(request.post_data_json)
                w.on('request', position_request)
                close_sheet(w)
                w.locator('#places-button').click()
                w.get_by_role('button', name='Walk to TownSquare · Institution Records', exact=True).click()
                expect(w.locator('#sheet')).to_be_hidden()
                expect(w.locator('#sheet')).to_be_visible(timeout=20000)
                w.get_by_role('heading', name='FOUNDER GATE', exact=True).wait_for()
                records(w, report)
                assert len(positions) >= 2, 'No actual walking presence trajectory was observed'
                assert positions[0]['x'] < 500 and positions[-1]['x'] > 950, positions
                # Presence is emitted only while moving, at most once per
                # 1.5 seconds. After arrival the final walk sample can be far
                # behind. Wait out that actual throttle, then sample one
                # native keyboard nudge; no player internals are modified.
                w.wait_for_timeout(1600)
                close_sheet(w)
                w.locator('#world').focus()
                with w.expect_request(lambda request: request.url.endswith('/api/presence') and request.method == 'POST') as arrival:
                    w.keyboard.down('ArrowRight')
                w.keyboard.up('ArrowRight')
                arrival_position = arrival.value.post_data_json
                assert math.hypot(arrival_position['x'] - 1040, arrival_position['y'] - 440) < 100, arrival_position
                w.locator('#interact-button').click()
                w.get_by_role('heading', name='FOUNDER GATE', exact=True).wait_for()
                records(w, report)
                record('places-physical-town-square-arrival', presenceSamples=len(positions),
                       firstPosition=positions[0], arrivalPosition=arrival_position,
                       arrivalPositionProbe='First presence sample after one native keyboard nudge, after the 1.5-second throttle interval',
                       arrivalOpenedInstitution=True, viewport=no_overflow(w))

                start_shared(a, url)
                login(a)
                evaluation = PRIVATE + '\n' + report_bytes.decode('utf-8')
                evaluation_bytes = evaluation.encode('utf-8')
                receipt = {'algorithm': 'sha256', 'digest': sha256(evaluation_bytes), 'size': len(evaluation_bytes)}
                policy = {'id': 'browser-synthetic-fixture-policy', 'reviewWindowMs': 86400000,
                          'basis': 'Synthetic browser fixture only; not the Founder operational 24-hour policy activation.'}
                proposal = {'id': DECISION_ID, 'title': 'Synthetic fixture: retain exporter for review',
                            'evaluation': {'bytes': evaluation, 'receipt': receipt},
                            'risks': ['Synthetic fixture risk: local execution is not external verification.'],
                            'rollback': 'Synthetic fixture rollback: keep M0 source; no source promotion occurs.',
                            'proposedEffect': 'Record this synthetic fixture disposition only; execute no promotion.'}
                post(owner, url, 'api/decisions/policy', policy)
                created = post(owner, url, 'api/decisions/proposals', proposal)
                assert created['status'] == 'PENDING' and created['evaluation']['receipt'] == receipt
                institution(a)
                card = a.locator(f'[data-decision-id="{DECISION_ID}"]')
                expect(card.locator('[data-gate-action]')).to_have_count(3)
                for action in ['APPROVE', 'REJECT', 'DEFER']:
                    expect(card.get_by_role('button', name=action, exact=True)).to_be_enabled()
                card.get_by_text('Retained evaluation bytes', exact=True).click()
                expect(card.locator('pre')).to_have_text(evaluation)
                screenshot(a, 'founder-desktop-private-evaluation.png')
                record('founder-authenticated-fixture-review', evaluationReceipt=receipt, actions=['APPROVE', 'REJECT', 'DEFER'],
                       policyFixture=True, operationalPolicyActivated=False, viewport=no_overflow(a))

                institution(w)
                records(w, report)
                redacted = witness_redacted(w, witness, url)
                assert redacted['decisions'][0]['status'] == 'PENDING'
                forbidden = {}
                for route, payload in [('policy', policy), ('proposals', proposal), ('choose', {
                        'decisionId': DECISION_ID, 'expectedRevision': 1, 'requestId': 'browser-forbidden', 'action': 'APPROVE'})]:
                    denied = post(witness, url, 'api/decisions/' + route, payload, status=403)
                    forbidden[route] = denied['error']['code']
                assert witness.request.get(url + 'api/decisions').json()['decisions'][0]['status'] == 'PENDING'
                screenshot(w, 'witness-phone-redacted-gate.png')
                record('witness-private-redaction-and-denied-writes', deniedWrites=forbidden, viewport=no_overflow(w))

                with a.expect_response(lambda response: response.url.endswith('/api/decisions/choose') and response.request.method == 'POST') as native:
                    card.get_by_role('button', name='DEFER', exact=True).click()
                assert native.value.status == 200
                native_request = native.value.request.post_data_json
                assert native_request['action'] == 'DEFER' and native_request['expectedRevision'] == 1
                assert native_request['requestId']
                expect(a.locator(f'[data-decision-id="{DECISION_ID}"]')).to_contain_text('DEFERRED')
                retained = owner.request.get(url + 'api/decisions').json()['decisions'][0]
                assert retained['status'] == 'DEFERRED' and retained['revision'] == 2
                assert retained['evaluation']['receipt'] == receipt
                assert a.locator('[data-gate-action]').count() == 0
                record('native-founder-defer-no-auto-promotion', disposition=retained['disposition'],
                       retainedStatus='DEFERRED', retainedRevision=2, game=unchanged_game(owner, url))

                other = attach(owner, 'same-cookie-other-page')
                other.goto(url, wait_until='domcontentloaded')
                other.locator('#start-shared').click()
                expect(other.locator('#mode-label')).to_contain_text('Founder')
                institution(other)
                other.get_by_text('Retained evaluation bytes', exact=True).click()
                expect(other.locator('#sheet-content pre')).to_have_text(evaluation)
                close_sheet(a)
                a.locator('#logout-button').click()
                expect(a.locator('#mode-label')).to_contain_text('Witness')
                expect(other.locator('#mode-label')).to_contain_text('Witness')
                expect(other.locator('#sheet')).to_be_hidden()
                assert PRIVATE not in other.locator('body').text_content()
                assert other.locator('#sheet-content pre').count() == 0
                institution(other)
                witness_redacted(other, owner, url)
                post(owner, url, 'api/decisions/choose', {
                    'decisionId': DECISION_ID, 'expectedRevision': 2, 'requestId': 'browser-after-logout', 'action': 'APPROVE'}, status=403)
                record('same-cookie-other-page-logout-clears-private-dom', otherPageDemoted=True,
                       privateDOMCleared=True, subsequentWriteStatus=403)

                # Keep a real authenticated cookie across restart, then prove it
                # carries no authority when used against the restarted process.
                login(a)
                cookies = owner.cookies()
                prior_cookies = [cookie for cookie in cookies if cookie['name'] == 'ngl_session']
                assert len(prior_cookies) == 1 and prior_cookies[0]['value'], 'No authenticated fixture session cookie was captured'
                assert owner.request.get(url + 'api/state').json()['viewer']['role'] == 'founder'
                owner.close()
                witness.close()
                stop_server(process)
                process, url = launch_server(data, report_path)
                restored_context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                restored_context.add_cookies([{**cookie, 'domain': '127.0.0.1'} for cookie in cookies])
                fresh = attach(restored_context, 'restarted-desktop')
                stale_cookie_presented = []
                def observe_stale_cookie(request):
                    if request.url.endswith('/api/state'):
                        stale_cookie_presented.append(
                            'ngl_session=' + prior_cookies[0]['value'] in (request.header_value('cookie') or ''))
                fresh.on('request', observe_stale_cookie)
                start_shared(fresh, url)
                assert stale_cookie_presented and stale_cookie_presented[0], 'Restart probe did not actually send the former authenticated cookie'
                fresh_gate = restored_context.request.get(url + 'api/decisions').json()
                assert fresh_gate['decisions'][0]['status'] == 'DEFERRED'
                institution(fresh)
                witness_redacted(fresh, restored_context, url)
                assert restored_context.request.get(url + 'api/state').json()['viewer']['role'] == 'witness'
                post(restored_context, url, 'api/decisions/choose', {
                    'decisionId': DECISION_ID, 'expectedRevision': 2,
                    'requestId': 'browser-stale-cookie', 'action': 'APPROVE'}, status=403)
                login(fresh)
                institution(fresh)
                restored = restored_context.request.get(url + 'api/decisions').json()['decisions'][0]
                assert restored == retained, 'Retained decision changed across process restart'
                expect(fresh.locator(f'[data-decision-id="{DECISION_ID}"]')).to_contain_text('DEFERRED')
                fresh.get_by_text('Retained evaluation bytes', exact=True).click()
                expect(fresh.locator('#sheet-content pre')).to_have_text(evaluation)
                screenshot(fresh, 'restarted-founder-desktop.png')
                record('durable-restart-default-witness-then-founder-review', retainedStatus=restored['status'],
                       retainedReceipt=restored['evaluation']['receipt'], staleAuthenticatedCookieRole='witness',
                       staleAuthenticatedCookieActuallyPresented=True, staleCookieWriteStatus=403,
                       sameDataDirectory=True, viewport=no_overflow(fresh), game=unchanged_game(restored_context, url))

                fresh.set_viewport_size({'width': 390, 'height': 844})
                screenshot(fresh, 'founder-phone-private-evaluation.png')
                record('founder-phone-private-evaluation-layout', viewport=no_overflow(fresh))
                restored_context.close()
                assert result['pageErrors'] == [], result['pageErrors']
                assert result['externalRequests'] == [], result['externalRequests']
                result['sourceUnchangedDuringRun'] = all(
                    sha256((ROOT / name).read_bytes()) == digest
                    for name, digest in result['sourceHashes'].items())
                assert result['sourceUnchangedDuringRun'], 'Application or harness source changed during acceptance; rerun after source freeze'
                assert sha256(report_path.read_bytes()) == result['report']['sha256'], 'Supplied report changed during acceptance'
                result['passed'] = True
            except Exception:
                for label, page in pages:
                    if not page.is_closed():
                        try:
                            screenshot(page, 'failed-' + label + '.png')
                        except Exception:
                            pass
                raise
            finally:
                browser.close()
                stop_server(process)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True, help='Retained compounding experiment JSON')
    parser.add_argument('--out', required=True, help='Results and screenshots directory')
    parser.add_argument('--synthetic', action='store_true', help='Label a synthetic report fixture run explicitly')
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    result = {'passed': False}
    try:
        run(args, result)
    except Exception as error:
        result['error'] = str(error)
        result['traceback'] = traceback.format_exc()
        raise
    finally:
        (out / 'results.json').write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
