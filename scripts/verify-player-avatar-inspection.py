"""Focused mobile acceptance for shared player-avatar inspection and progression.

Two independent browser contexts enter the same disposable server. Each taps the
other co-located world avatar and inspects its public session card. A Founder
publication is then observed by the Witness;
character XP/skills remain actor-scoped while the published place is shared.
Session presence is never treated as proof of two humans or authority.
"""
import argparse
import importlib.util
import json
import math
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CLERK_SCRIPT = ROOT / 'scripts' / 'verify-contradiction-clerk-quest.py'
SPEC = importlib.util.spec_from_file_location('ngl_clerk_mobile_helpers', CLERK_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('Could not load the existing mobile game-server helpers.')
clerk = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = clerk
SPEC.loader.exec_module(clerk)
quest = clerk.quest

EVENT_STREAM_PROBE = r"""
(() => {
  const NativeEventSource = window.EventSource;
  if (typeof NativeEventSource !== 'function' || window.__nglEventSourceProbeInstalled) return;
  window.__nglEventSourceProbeInstalled = true;
  window.__nglObservedStreams = [];
  window.__nglCanvasPointerEvents = [];
  document.addEventListener('pointerdown', event => {
    if (event.target?.id === 'world') {
      window.__nglCanvasPointerEvents.push({
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        at: Date.now()
      });
    }
  }, true);
  window.EventSource = class extends NativeEventSource {
    addEventListener(type, listener, options) {
      if ((type === 'presence' || type === 'world') && typeof listener === 'function') {
        const wrapped = event => {
          try {
            window.__nglObservedStreams.push({ type, data: JSON.parse(event.data) });
          } catch {}
          return listener.call(this, event);
        };
        return super.addEventListener(type, wrapped, options);
      }
      return super.addEventListener(type, listener, options);
    }
  };
})();
"""


def read_state(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared state read failed: ' + response.status);
      return await response.json();
    }""")


def world_snapshot(dto):
    world = dto.get('world') if isinstance(dto, dict) else None
    if not isinstance(world, dict) or not isinstance(world.get('events'), list):
        raise AssertionError('The server did not return a bounded retained-world projection.')
    return {
        'revision': world.get('revision'),
        'xp': world.get('xp'),
        'eventIds': [event.get('id') for event in world['events']],
        'creationVersions': sorted(
            (creation.get('id'), creation.get('version'))
            for creation in world.get('creations', [])
        )
    }


def wait_for_two_sessions(page):
    page.wait_for_function("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) return false;
      const dto = await response.json();
      return Array.isArray(dto.presence) && dto.presence.length === 2;
    }""", timeout=15000)
    page.wait_for_function("""() =>
      (window.__nglObservedStreams || []).some(item =>
        item.type === 'presence' && Array.isArray(item.data) && item.data.length === 2
      )
    """, timeout=15000)


def wait_for_world_interactive(page):
    page.bring_to_front()
    page.wait_for_function("""() => {
      const canvas = document.querySelector('#world');
      const doorway = document.querySelector('#doorway');
      const sheet = document.querySelector('#sheet');
      return document.hasFocus() &&
        canvas?.dataset.movementEnabled === 'true' &&
        doorway?.hidden === true &&
        sheet?.hidden === true &&
        !document.body.classList.contains('modal-open');
    }""", timeout=15000)
    page.wait_for_timeout(1200)


def wait_for_canvas_pointer(page, previous_count):
    page.wait_for_function(
        "(count) => (window.__nglCanvasPointerEvents || []).length > count",
        arg=previous_count,
        timeout=5000
    )


def remote_avatar_target(page, target_role):
    state = read_state(page)
    viewer = state.get('viewer') or {}
    self_presence_id = viewer.get('presenceId')
    candidates = [
        player for player in state.get('presence', [])
        if player.get('id') != self_presence_id and player.get('role') == target_role
    ]
    assert len(candidates) == 1, {
        'targetRole': target_role,
        'selfPresenceId': self_presence_id,
        'candidates': [
            {key: player.get(key) for key in ('id', 'actorId', 'role', 'x', 'y')}
            for player in candidates
        ]
    }
    remote = candidates[0]
    local = viewer.get('position')
    if not isinstance(local, dict):
        raise AssertionError('The inspecting character has no authoritative position.')
    box = page.locator('#world').bounding_box()
    if not box:
        raise AssertionError('The pixel-world canvas is not visible before avatar inspection.')
    width, height = box['width'], box['height']
    zoom = 0.78 if width < 600 else max(0.64, min(0.92, width / 1500))
    visible_width, visible_height = width / zoom, height / zoom
    camera_x = max(visible_width / 2, min(1600 - visible_width / 2, local['x'] + 100))
    camera_y = max(visible_height / 2, min(1000 - visible_height / 2, local['y'] - 50))
    point = {
        'x': (remote['x'] - camera_x) * zoom + width / 2,
        'y': (remote['y'] - camera_y) * zoom + height / 2
    }
    assert 0 <= point['x'] <= width and 0 <= point['y'] <= height, {
        'remote': remote, 'local': local, 'camera': [camera_x, camera_y],
        'zoom': zoom, 'canvas': [width, height], 'point': point
    }
    return state, remote, point


def inspect_remote_avatar(page, target_role, screenshot):
    wait_for_world_interactive(page)
    # The first tap is on the actual remote sprite. A distant target must route
    # only; a second explicit tap after arrival opens the read-only public card.
    page.wait_for_timeout(1200)
    before, remote, point = remote_avatar_target(page, target_role)
    local = before['viewer']['position']
    initial_distance = math.hypot(local['x'] - remote['x'], local['y'] - remote['y'])
    before_world = world_snapshot(before)
    profile = page.locator('[data-player-profile]')
    pointer_count = page.evaluate("() => (window.__nglCanvasPointerEvents || []).length")
    page.locator('#world').tap(position=point)
    wait_for_canvas_pointer(page, pointer_count)
    routed = initial_distance >= 160

    if routed:
        page.wait_for_timeout(250)
        assert not profile.is_visible(), (
            'A distant avatar tap must route toward the player, not open its profile.'
        )
        stable = 0
        previous_position = None
        current = before
        current_remote = remote
        current_distance = initial_distance
        for _ in range(80):
            current, current_remote, _ = remote_avatar_target(page, target_role)
            current_position = current['viewer']['position']
            current_distance = math.hypot(
                current_position['x'] - current_remote['x'],
                current_position['y'] - current_remote['y']
            )
            if current_distance < 120 and current_position == previous_position:
                stable += 1
            else:
                stable = 0
            previous_position = dict(current_position)
            if stable >= 6:
                break
            page.wait_for_timeout(250)
        assert stable >= 6, {
            'message': 'The player-avatar route did not reach a stable interaction position.',
            'distance': current_distance,
            'local': current.get('viewer', {}).get('position'),
            'remote': current_remote,
            'navigationState': page.locator('#world').get_attribute('data-navigation-state'),
            'nearbyPlayerRole': page.locator('#world').get_attribute('data-nearby-player-role')
        }
        assert world_snapshot(current) == before_world, (
            'Approaching another player must not append an event, award XP, or change artifacts.'
        )
        page.wait_for_timeout(1200)
        current, current_remote, point = remote_avatar_target(page, target_role)
        final_distance = math.hypot(
            current['viewer']['position']['x'] - current_remote['x'],
            current['viewer']['position']['y'] - current_remote['y']
        )
        assert final_distance < 160, {
            'message': 'The second avatar tap requires the target to be within interaction range.',
            'distance': final_distance, 'local': current['viewer']['position'],
            'remote': current_remote
        }
        expect(page.locator('#world')).to_have_attribute('data-nearby-player-role', target_role)
        pointer_count = page.evaluate("() => (window.__nglCanvasPointerEvents || []).length")
        page.locator('#world').tap(position=point)
        wait_for_canvas_pointer(page, pointer_count)
    else:
        page.wait_for_timeout(250)

    expect(profile).to_be_visible(timeout=10000)
    expect(profile).to_have_attribute('data-player-role', target_role)
    expect(profile).to_contain_text('PRESENT IN THE LATEST SHARED SNAPSHOT')
    expect(profile).to_contain_text('not a distinct human')
    expect(profile).to_contain_text('Inspection is read-only')
    character = profile.locator('[data-player-profile-character]')
    expect(character).to_have_count(1)
    details = {
        'role': profile.get_attribute('data-player-role'),
        'level': character.get_attribute('data-level'),
        'xp': character.get_attribute('data-xp'),
        'sharedPublishedPlaces': character.get_attribute('data-shared-published-place-count'),
        'fieldItems': character.get_attribute('data-field-item-count'),
        'activeSkills': character.get_attribute('data-active-skill-count'),
        'makerSkillCount': (
            profile.locator('[data-player-profile-skill="maker"]').get_attribute('data-count')
            if profile.locator('[data-player-profile-skill="maker"]').count() else None
        )
    }
    after = read_state(page)
    assert world_snapshot(after) == world_snapshot(before), (
        'Opening a public player card must be read-only.'
    )
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        'targetRole': target_role,
        'initialDistance': initial_distance,
        'routedBeforeInspection': routed,
        'profile': details,
        'worldUnchangedByInspection': True,
        'positionAfterInspection': after['viewer']['position']
    }


def close_sheet(page):
    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='artifacts/player-avatar-inspection')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    result = {'journey': 'two-session-mobile-player-avatar-inspection', 'passed': False}
    founder_context = None
    witness_context = None
    process = None
    founder_page = None
    witness_page = None
    founder_errors = []
    witness_errors = []

    with tempfile.TemporaryDirectory(prefix='ngl-player-avatar-inspection-') as data_dir:
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
                    witness_context = browser.new_context(
                        viewport={'width': 390, 'height': 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    founder_page = founder_context.new_page()
                    witness_page = witness_context.new_page()
                    founder_page.add_init_script(EVENT_STREAM_PROBE)
                    witness_page.add_init_script(EVENT_STREAM_PROBE)

                    clerk.start_shared_actor(founder_page, url, 'founder', founder_errors)
                    clerk.start_shared_actor(witness_page, url, 'witness', witness_errors)
                    wait_for_two_sessions(founder_page)
                    wait_for_two_sessions(witness_page)

                    founder_initial = read_state(founder_page)
                    witness_initial = read_state(witness_page)
                    founder_id = founder_initial['viewer']['id']
                    witness_id = witness_initial['viewer']['id']
                    founder_presence_id = founder_initial['viewer']['presenceId']
                    witness_presence_id = witness_initial['viewer']['presenceId']
                    assert founder_initial['viewer']['role'] == 'founder'
                    assert witness_initial['viewer']['role'] == 'witness'
                    assert founder_id != witness_id
                    assert founder_presence_id != witness_presence_id
                    founder_cookies = founder_context.cookies(url)
                    witness_cookies = witness_context.cookies(url)
                    assert founder_cookies and witness_cookies
                    assert {cookie['value'] for cookie in founder_cookies}.isdisjoint(
                        {cookie['value'] for cookie in witness_cookies}
                    ), 'Separate browser contexts must hold distinct opaque session cookies.'

                    for dto, other_id, other_role in [
                        (founder_initial, witness_id, 'witness'),
                        (witness_initial, founder_id, 'founder')
                    ]:
                        assert any(
                            player.get('actorId') == other_id and player.get('role') == other_role
                            for player in dto.get('presence', [])
                        ), 'Each client must receive the other session in authoritative presence.'

                    # Each client explicitly taps the other avatar on its own
                    # mobile canvas. Both sessions share the same spawn tile.
                    founder_inspection = inspect_remote_avatar(
                        founder_page, 'witness', out / 'founder-inspects-witness-320.png'
                    )
                    assert founder_inspection['routedBeforeInspection'] is False
                    assert founder_inspection['profile']['xp'] == '0'
                    close_sheet(founder_page)

                    witness_inspection = inspect_remote_avatar(
                        witness_page, 'founder', out / 'witness-inspects-founder-390.png'
                    )
                    assert witness_inspection['routedBeforeInspection'] is False
                    assert witness_inspection['profile']['xp'] == '0'
                    close_sheet(witness_page)

                    # A real, explicitly submitted test publication becomes one
                    # shared world object/event. It is a fixture, not a truth claim.
                    fixture = quest.publish_fixture(founder_page)
                    creation_id = fixture.get('creationId')
                    version = fixture.get('version')
                    assert isinstance(creation_id, str) and isinstance(version, int)
                    clerk.wait_for_published_fixture(founder_page)
                    witness_page.wait_for_function("""([id, version]) =>
                      (window.__nglObservedStreams || []).some(item =>
                        item.type === 'world' &&
                        item.data?.world?.creations?.some(creation =>
                          creation.id === id && creation.version === version
                        )
                      )
                    """, arg=[creation_id, version], timeout=15000)

                    founder_published = read_state(founder_page)
                    witness_published = read_state(witness_page)
                    founder_creation = next(
                        creation for creation in founder_published['world']['creations']
                        if creation['id'] == creation_id
                    )
                    witness_creation = next(
                        creation for creation in witness_published['world']['creations']
                        if creation['id'] == creation_id
                    )
                    assert founder_creation['version'] == version
                    assert witness_creation['version'] == version
                    assert founder_published['world']['revision'] == witness_published['world']['revision']
                    publication_events = [
                        event for event in founder_published['world']['events']
                        if event.get('type') == 'publish' and
                        event.get('creationId') == creation_id and event.get('version') == version
                    ]
                    assert len(publication_events) == 1, publication_events
                    publication_event = publication_events[0]
                    assert publication_event.get('actor', {}).get('id') == founder_id
                    assert publication_event.get('actor', {}).get('role') == 'founder'
                    assert publication_event.get('reward') == 100
                    assert any(
                        event.get('id') == publication_event.get('id')
                        for event in witness_published['world']['events']
                    ), 'The Witness must receive the same retained publication event.'
                    assert founder_published['world']['xp'] == witness_published['world']['xp']
                    assert founder_published['world']['xp'] >= 100

                    # The profile is a deterministic actor-scoped projection over
                    # the shared publication: Founder gets 100 XP and Maker 1;
                    # Witness gets neither, while both see one shared place.
                    founder_after_publish_profile = inspect_remote_avatar(
                        witness_page, 'founder', out / 'witness-sees-founder-progression-390.png'
                    )
                    founder_character = founder_after_publish_profile['profile']
                    assert founder_character['xp'] == '100', founder_character
                    assert founder_character['sharedPublishedPlaces'] == '1', founder_character
                    close_sheet(witness_page)

                    witness_after_publish_profile = inspect_remote_avatar(
                        founder_page, 'witness', out / 'founder-sees-witness-progression-320.png'
                    )
                    witness_character = witness_after_publish_profile['profile']
                    assert witness_character['xp'] == '0', witness_character
                    assert witness_character['sharedPublishedPlaces'] == '1', witness_character
                    close_sheet(founder_page)

                    founder_state_after = read_state(founder_page)
                    witness_state_after = read_state(witness_page)
                    assert founder_state_after['world']['revision'] == witness_state_after['world']['revision']
                    assert founder_character['makerSkillCount'] == '1', founder_character
                    assert witness_character['makerSkillCount'] is None, witness_character

                    assert not founder_errors, 'Founder page errors: ' + json.dumps(founder_errors)
                    assert not witness_errors, 'Witness page errors: ' + json.dumps(witness_errors)

                    result.update({
                        'passed': True,
                        'sessions': {
                            'founderId': founder_id,
                            'founderPresenceId': founder_presence_id,
                            'witnessId': witness_id,
                            'witnessPresenceId': witness_presence_id,
                            'distinctOpaqueCookies': True,
                            'twoSeparateBrowserContexts': True
                        },
                        'presence': {
                            'founderObservedWitness': True,
                            'witnessObservedFounder': True,
                            'bothAtSharedSpawnTile': True,
                            'founderPresenceCount': len(founder_initial.get('presence', [])),
                            'witnessPresenceCount': len(witness_initial.get('presence', []))
                        },
                        'avatarInspection': {
                            'founderInspectedWitness': founder_inspection,
                            'witnessInspectedFounder': witness_inspection,
                            'bothInspectionsReadOnly': True
                        },
                        'sharedPublication': {
                            'creationId': creation_id,
                            'version': version,
                            'publicationEventId': publication_event['id'],
                            'visibleToBothClients': True,
                            'worldRevision': founder_published['world']['revision'],
                            'globalWorldXp': founder_published['world']['xp'],
                            'founderCharacterXp': founder_character['xp'],
                            'witnessCharacterXp': witness_character['xp'],
                            'sharedPublishedPlaceCount': 1,
                            'fixtureIsTruthClaim': False
                        },
                        'pageErrors': {'founder': founder_errors, 'witness': witness_errors},
                        'limitations': [
                            'Separate browser contexts and opaque cookies establish separate sessions, not two distinct humans.',
                            'The server and data directory are disposable test fixtures, not production backup/restore evidence.',
                            'The publication is a test fixture and establishes no real-world claim.',
                            'Distant avatar approach is not proven by this direct co-located inspection journey.',
                            'A prior touch-movement setup tap reached the canvas but the target position was not retained; the cause remains unknown.',
                            'This is hosted Chromium at mobile viewport sizes, not physical Android device acceptance.'
                        ]
                    })
                    (out / 'results.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n', encoding='utf-8')
                    print(json.dumps(result, sort_keys=True), flush=True)
                finally:
                    if founder_context:
                        founder_context.close()
                    if witness_context:
                        witness_context.close()
                    browser.close()
        finally:
            try:
                quest.stop_server(process)
            except Exception:
                if process and process.poll() is None:
                    process.kill()
                    process.wait()
                raise


def main_wrapper():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--out', default='artifacts/player-avatar-inspection')
    args, _ = parser.parse_known_args()
    out = Path(args.out)
    try:
        main()
    except Exception as error:
        out.mkdir(parents=True, exist_ok=True)
        failure = {
            'journey': 'two-session-mobile-player-avatar-inspection',
            'passed': False,
            'error': str(error)
        }
        (out / 'failure.json').write_text(json.dumps(failure, indent=2) + '\n', encoding='utf-8')
        raise

if __name__ == '__main__':
    main_wrapper()
