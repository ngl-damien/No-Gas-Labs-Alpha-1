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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='artifacts/contradiction-clerk-quest-mobile')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []

    with tempfile.TemporaryDirectory(prefix='ngl-contradiction-clerk-quest-') as data_dir:
        process, url = quest.launch_server(data_dir)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=['--no-sandbox'])
                try:
                    founder_context = browser.new_context(
                        viewport={'width': 320, 'height': 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    try:
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
                    finally:
                        founder_context.close()

                    witness_context = browser.new_context(
                        viewport={'width': 390, 'height': 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    try:
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
                    finally:
                        witness_context.close()
                finally:
                    browser.close()
        finally:
            quest.stop_server(process)

    (out / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results))


if __name__ == '__main__':
    main()
