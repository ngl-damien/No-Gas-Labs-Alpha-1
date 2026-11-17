"""Focused mobile acceptance for the Contradiction Clerk Quest Board objective.

This imports the existing NPC/report journey without modifying the shared
verify-quest-board.py harness while its divergent branches are being reconciled.
"""
import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHARED_ACCEPTANCE = ROOT / 'scripts' / 'verify-quest-board.py'
SPEC = importlib.util.spec_from_file_location('ngl_shared_quest_board_acceptance', SHARED_ACCEPTANCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('Could not load the shared Quest Board acceptance helpers.')
quest = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = quest
SPEC.loader.exec_module(quest)


def start_shared_actor(page, url, role, page_errors):
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.goto(url, wait_until='networkidle')
    page.locator('#start-shared').tap()
    page.locator('#world').wait_for(state='visible')
    expect(page.locator('#world')).to_have_attribute('data-world-renderer', 'pixel-v1')
    page.wait_for_function(
        "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
    )
    if role == 'founder':
        page.locator('#login-button').tap()
        page.locator('#founder-name').fill('Damien')
        page.locator('#founder-key').fill('fake-browser-fixture-key-not-a-secret')
        page.locator('#verify-founder').tap()
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
    else:
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )


def wait_for_published_fixture(page):
    page.wait_for_function(
        "() => Number(document.querySelector('#creation-count')?.textContent) >= 1 && "
        "Number(document.querySelector('#xp-count')?.textContent) >= 100",
        timeout=15000
    )


def run_actor_quest_journey(page, artifact, out, viewport_width, expected_role, page_errors):
    # The objective must exist before the report, be actor-scoped, and route
    # through the owning institution without granting XP or changing evidence.
    quest.open_quest_board(page)
    open_objective = page.locator(
        f'#sheet-content [data-objective-id="{expected_role}-contradiction-clerk-report"]'
    )
    expect(open_objective).to_have_count(1)
    expect(open_objective.locator('.quest-step-state')).to_have_text('OPEN')
    expect(open_objective).to_contain_text('0/1')
    expect(open_objective).to_contain_text('byte identity, not truth')
    open_action = open_objective.get_by_role('button', name='Go do this →', exact=True)
    expect(open_action).to_be_visible()

    objective_route_before = quest.authoritative_snapshot(page)
    open_action.tap()
    page.wait_for_function(
        "() => document.querySelector('#world')?.dataset.nearbyInstitutionId === 'evidence_archive' && "
        "document.querySelector('#sheet')?.hidden === true",
        timeout=45000
    )
    quest.enter_nearby_institution(page, 'evidence_archive', 'Evidence Archive', 'Evidence Archive')
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    objective_route_after = quest.authoritative_snapshot(page)
    objective_route_events = quest.assert_navigation_only(
        objective_route_before, objective_route_after, expected_role,
        'Contradiction Clerk quest destination'
    )
    page.locator('#sheet-close').tap()

    # Reuse the established two-step NPC approach -> talk -> explicit report
    # acceptance. This helper is imported read-only from the shared harness.
    result = quest.run_contradiction_clerk_mobile_journey(
        page, artifact, out, viewport_width, expected_role
    )

    # The report must complete the same actor's objective. Opening the board
    # may add only navigation discovery; inspecting evidence is read-only.
    quest_before = quest.authoritative_snapshot(page)
    page.locator('#sheet-close').tap()
    quest.open_quest_board(page)
    quest_after = quest.authoritative_snapshot(page)
    quest_navigation_events = quest.assert_navigation_only(
        quest_before, quest_after, expected_role,
        'Contradiction Clerk Quest Board refresh'
    )
    completed_objective = page.locator(
        f'#sheet-content [data-objective-id="{expected_role}-contradiction-clerk-report"]'
    )
    expect(completed_objective).to_have_count(1)
    expect(completed_objective.locator('.quest-step-state')).to_have_text('RECORDED')
    expect(completed_objective).to_contain_text('1/1')
    expect(completed_objective).to_contain_text('report-submission practice only')
    expect(completed_objective.get_by_role('button', name='Go do this →', exact=True)).to_have_count(0)

    evidence_detail = completed_objective.locator('details.quest-evidence')
    expect(evidence_detail).to_have_count(1)
    quest_read_before = quest.authoritative_snapshot(page)
    evidence_detail.locator('summary').tap()
    report_event_id = result['reportEventId']
    expect(evidence_detail).to_contain_text(report_event_id)
    quest_read_after = quest.authoritative_snapshot(page)
    assert quest_read_after == quest_read_before, (
        'Inspecting the completed Clerk objective must not mutate revision, events, XP, or artifact versions.'
    )
    assert not page_errors, 'Browser page errors: ' + json.dumps(page_errors)

    quest_screenshot = out / ('contradiction-clerk-quest-board-' + str(viewport_width) + '.png')
    page.screenshot(path=str(quest_screenshot), full_page=True)
    result['questBeforeReport'] = {
        'objectiveId': expected_role + '-contradiction-clerk-report',
        'state': 'OPEN',
        'progress': '0/1',
        'destination': 'evidence_archive',
        'navigationOnly': True,
        'navigationEventIds': [event['id'] for event in objective_route_events],
        'xpUnchanged': objective_route_after['xp'] == objective_route_before['xp']
    }
    result['questAfterReport'] = {
        'objectiveId': expected_role + '-contradiction-clerk-report',
        'state': 'RECORDED',
        'progress': '1/1',
        'evidenceEventId': report_event_id,
        'navigationOnly': True,
        'navigationEventIds': [event['id'] for event in quest_navigation_events],
        'readOnlyEvidenceInspection': quest_read_after == quest_read_before,
        'xpUnchanged': quest_after['xp'] == quest_before['xp']
    }
    result['questScreenshot'] = quest_screenshot.name
    result['pageErrors'] = list(page_errors)
    return result



def capture_session_cookie(context, url):
    cookie = next(
        (item for item in context.cookies([url]) if item.get('name') == 'ngl_session'),
        None
    )
    if cookie is None or not isinstance(cookie.get('value'), str) or not cookie['value']:
        raise AssertionError('The actor session cookie was unavailable for restart acceptance.')
    return {
        'name': cookie['name'],
        'value': cookie['value'],
        'httpOnly': bool(cookie.get('httpOnly')),
        'secure': bool(cookie.get('secure')),
        'sameSite': cookie.get('sameSite', 'Strict'),
        'expires': cookie.get('expires', -1)
    }


def restore_session_cookie(context, cookie, url):
    restored = {
        'name': cookie['name'],
        'value': cookie['value'],
        'url': url,
        'httpOnly': cookie['httpOnly'],
        'secure': cookie['secure'],
        'sameSite': cookie['sameSite']
    }
    if isinstance(cookie.get('expires'), (int, float)) and cookie['expires'] > 0:
        restored['expires'] = cookie['expires']
    context.add_cookies([restored])


def restart_server_on_same_port(data_dir, url):
    port = int(url.rsplit(':', 1)[1].rstrip('/'))
    original_server = quest.SERVER
    marker = "server.listen(0,"
    if marker not in original_server:
        raise AssertionError('The shared disposable-server launcher no longer exposes its ephemeral listen port.')
    quest.SERVER = original_server.replace(marker, f"server.listen({port},", 1)
    try:
        process, restarted_url = quest.launch_server(data_dir)
    finally:
        quest.SERVER = original_server
    if restarted_url != url:
        quest.stop_server(process)
        raise AssertionError('The disposable server did not resume on the same origin after restart.')
    return process, restarted_url


def assert_recorded_quest_survives_restart(
    page, url, artifact, out, viewport_width, role, result,
    before_world, before_clerk, page_errors
):
    # Founder cookies restore as Witness after process loss and must be
    # re-authenticated. A Witness cookie restores only its pseudonymous actor.
    start_shared_actor(page, url, role, page_errors)
    after_world = quest.authoritative_snapshot(page)
    after_clerk = quest.contradiction_clerk_snapshot(page, artifact['creationId'])

    assert after_world['viewerId'] == before_world['viewerId'], (
        role + ' actor identity must survive the service restart under its documented session rules.'
    )
    assert after_world['viewerRole'] == role
    for key in ('revision', 'xp', 'eventIds', 'creationVersions'):
        assert after_world[key] == before_world[key], (
            'Server restart and session recovery must not change world ' + key + '.'
        )
    assert after_clerk['viewerId'] == before_clerk['viewerId']
    assert after_clerk['viewerRole'] == role
    assert after_clerk['revision'] == before_clerk['revision']
    assert after_clerk['xp'] == before_clerk['xp']
    assert after_clerk['eventIds'] == before_clerk['eventIds']
    assert after_clerk['reports'] == before_clerk['reports'], (
        'The exact actor-attributed report record must survive restart without duplication or rewriting.'
    )

    report_events = [
        event for event in after_clerk['events']
        if event['id'] == result['reportEventId']
    ]
    assert len(report_events) == 1, 'The exact report event must survive restart exactly once.'
    report_event = report_events[0]
    assert report_event['type'] == 'report'
    assert report_event['creationId'] == artifact['creationId']
    assert report_event['version'] == artifact['version']
    assert report_event['actor']['id'] == before_world['viewerId']
    assert report_event['actor']['role'] == role

    report_records = [
        report for report in after_clerk['reports']
        if report['id'] == result['reportId']
    ]
    assert len(report_records) == 1, 'The exact retained report record must survive restart exactly once.'
    report_record = report_records[0]
    assert report_record['creationId'] == artifact['creationId']
    assert report_record['version'] == artifact['version']
    assert report_record['actor']['id'] == before_world['viewerId']
    assert report_record['actor']['role'] == role
    assert result['reportMarker'] in report_record['text']

    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').tap()
    board_before = quest.authoritative_snapshot(page)
    quest.open_quest_board(page)
    board_after = quest.authoritative_snapshot(page)
    navigation_events = quest.assert_navigation_only(
        board_before, board_after, role, 'Post-restart Contradiction Clerk Quest Board recovery'
    )

    objective = page.locator(
        f'#sheet-content [data-objective-id="{role}-contradiction-clerk-report"]'
    )
    expect(objective).to_have_count(1)
    expect(objective.locator('.quest-step-state')).to_have_text('RECORDED')
    expect(objective).to_contain_text('1/1')
    expect(objective).to_contain_text('report-submission practice only')
    evidence_detail = objective.locator('details.quest-evidence')
    expect(evidence_detail).to_have_count(1)

    before_read = quest.authoritative_snapshot(page)
    evidence_detail.locator('summary').tap()
    expect(evidence_detail).to_contain_text(result['reportEventId'])
    after_read = quest.authoritative_snapshot(page)
    assert after_read == before_read, (
        'Inspecting the restored quest evidence must remain read-only after server restart.'
    )
    assert after_read['xp'] == before_world['xp']
    assert not page_errors, 'Browser page errors after server restart: ' + json.dumps(page_errors)

    screenshot = out / ('contradiction-clerk-quest-restart-' + role + '-' + str(viewport_width) + '.png')
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        'serverRestartRecovery': True,
        'viewerRole': role,
        'viewerIdPreserved': after_world['viewerId'] == before_world['viewerId'],
        'worldRevisionPreserved': after_world['revision'] == before_world['revision'],
        'worldEventIdsPreserved': after_world['eventIds'] == before_world['eventIds'],
        'reportEventPreservedExactlyOnce': len(report_events) == 1,
        'reportRecordPreservedExactlyOnce': len(report_records) == 1,
        'objectiveState': 'RECORDED',
        'progress': '1/1',
        'evidenceEventId': result['reportEventId'],
        'navigationOnly': True,
        'navigationEventIds': [event['id'] for event in navigation_events],
        'readOnlyEvidenceInspection': after_read == before_read,
        'xpUnchanged': after_read['xp'] == before_world['xp'],
        'pageErrors': list(page_errors),
        'screenshot': screenshot.name
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='artifacts/contradiction-clerk-quest-mobile')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []

    with tempfile.TemporaryDirectory(prefix='ngl-contradiction-clerk-quest-') as data_dir:
        process, url = quest.launch_server(data_dir)
        founder_context = None
        witness_context = None
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=['--no-sandbox'])
                try:
                    founder_context = browser.new_context(
                        viewport={'width': 320, 'height': 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    founder_page = founder_context.new_page()
                    founder_errors = []
                    start_shared_actor(founder_page, url, 'founder', founder_errors)
                    fixture = quest.publish_fixture(founder_page)
                    wait_for_published_fixture(founder_page)
                    artifact = {
                        'creationId': fixture['creationId'],
                        'version': fixture['version']
                    }
                    founder_result = run_actor_quest_journey(
                        founder_page, artifact, out, 320, 'founder', founder_errors
                    )
                    founder_result['journey'] = 'contradiction-clerk-quest-founder-320'
                    founder_result['passed'] = True
                    results.append(founder_result)
                    print(json.dumps(founder_result), flush=True)

                    witness_context = browser.new_context(
                        viewport={'width': 390, 'height': 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    witness_page = witness_context.new_page()
                    witness_errors = []
                    start_shared_actor(witness_page, url, 'witness', witness_errors)
                    wait_for_published_fixture(witness_page)
                    witness_before = quest.authoritative_snapshot(witness_page)
                    if witness_before['viewerRole'] != 'witness':
                        raise AssertionError('The second context did not receive a Witness character.')
                    witness_result = run_actor_quest_journey(
                        witness_page, artifact, out, 390, 'witness', witness_errors
                    )
                    witness_result['journey'] = 'contradiction-clerk-quest-witness-390'
                    witness_result['passed'] = True
                    results.append(witness_result)
                    print(json.dumps(witness_result), flush=True)

                    # Capture exact actor-bound state and opaque session cookies
                    # before a full service-process restart. The service store,
                    # not either browser context, must restore the world history.
                    founder_before_world = quest.authoritative_snapshot(founder_page)
                    founder_before_clerk = quest.contradiction_clerk_snapshot(founder_page, artifact['creationId'])
                    witness_before_world = quest.authoritative_snapshot(witness_page)
                    witness_before_clerk = quest.contradiction_clerk_snapshot(witness_page, artifact['creationId'])
                    founder_cookie = capture_session_cookie(founder_context, url)
                    witness_cookie = capture_session_cookie(witness_context, url)

                    founder_context.close()
                    founder_context = None
                    witness_context.close()
                    witness_context = None
                    quest.stop_server(process)
                    process, url = restart_server_on_same_port(data_dir, url)

                    # New browser contexts have no localStorage or in-memory
                    # state. Only the pre-existing opaque session cookies cross
                    # the process boundary.
                    founder_context = browser.new_context(
                        viewport={'width': 320, 'height': 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    restore_session_cookie(founder_context, founder_cookie, url)
                    founder_recovery_page = founder_context.new_page()
                    founder_recovery_errors = []
                    founder_recovery = assert_recorded_quest_survives_restart(
                        founder_recovery_page, url, artifact, out, 320, 'founder',
                        founder_result, founder_before_world, founder_before_clerk,
                        founder_recovery_errors
                    )
                    founder_recovery['journey'] = 'contradiction-clerk-quest-founder-restart-320'
                    founder_recovery['passed'] = True
                    results.append(founder_recovery)
                    print(json.dumps(founder_recovery), flush=True)

                    witness_context = browser.new_context(
                        viewport={'width': 390, 'height': 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    restore_session_cookie(witness_context, witness_cookie, url)
                    witness_recovery_page = witness_context.new_page()
                    witness_recovery_errors = []
                    witness_recovery = assert_recorded_quest_survives_restart(
                        witness_recovery_page, url, artifact, out, 390, 'witness',
                        witness_result, witness_before_world, witness_before_clerk,
                        witness_recovery_errors
                    )
                    witness_recovery['journey'] = 'contradiction-clerk-quest-witness-restart-390'
                    witness_recovery['passed'] = True
                    results.append(witness_recovery)
                    print(json.dumps(witness_recovery), flush=True)
                finally:
                    if founder_context is not None:
                        founder_context.close()
                    if witness_context is not None:
                        witness_context.close()
                    browser.close()
        finally:
            quest.stop_server(process)

    (out / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results))


if __name__ == '__main__':
    main()
