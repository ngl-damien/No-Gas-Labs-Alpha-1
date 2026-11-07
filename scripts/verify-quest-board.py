"""Mobile acceptance for the actor-scoped, in-world Quest Board.

The journey verifies that real retained publication activity changes the
Founder objective projection, while opening the board itself is read-only.
A rotated Witness receives a different actor-scoped objective trail.
"""
import argparse
import hashlib
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
        // Draft/repair events and actor-private reports are intentionally not
        // present in every actor's publicWorld projection. Compare the common
        // event surface when checking that separate clients share one world.
        mutuallyVisibleEventIds: world.events
          .filter(event => !['draft', 'repair', 'message-reported'].includes(event.type))
          .map(event => event.id),
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


def publish_observatory_fixture(page):
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
          'Observatory fixture action ' + action.type + ' failed (' + response.status + '): ' + JSON.stringify(payload)
        );
        return payload;
      };
      const draft = await post({
        type: 'draft',
        kind: 'observatory',
        title: 'Guild Dissent Circuit source',
        intent: 'Disposable browser fixture. A model assertion is a lead, not evidence.',
        html: '<main><h1>Source Observatory fixture</h1><p>No source was retrieved.</p></main>',
        requestId: 'quest-board-observatory-draft'
      });
      const draftId = draft.result?.draftId;
      if (typeof draftId !== 'string') throw new Error('Observatory fixture draft did not return a draft ID.');
      const publication = await post({
        type: 'publish',
        draftId,
        expectedVersion: 0,
        requestId: 'quest-board-observatory-publish'
      });
      if (typeof publication.result?.creationId !== 'string') {
        throw new Error('Observatory fixture publication did not return a retained creation ID.');
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
    circuit = content.locator(f'[data-objective-id="{role}-guild-dissent-circuit"]')
    expect(circuit).to_have_count(1)
    return rows




def assert_circuit_round_progress(page, role, round_number, progress, complete=False):
    suffix = '' if round_number == 1 else f'-{round_number}'
    row = page.locator(
        f'#sheet-content [data-objective-id="{role}-guild-dissent-circuit{suffix}"]'
    )
    expect(row).to_have_count(1)
    expect(row).to_contain_text(progress)
    expect(row.locator('.quest-step-state')).to_have_text('RECORDED' if complete else 'OPEN')


def assert_circuit_progress(page, role, progress, complete=False):
    assert_circuit_round_progress(page, role, 1, progress, complete)


def post_action(page, action):
    return page.evaluate("""async action => {
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(
        'Guild circuit action ' + action.type + ' failed (' + response.status + '): ' + JSON.stringify(payload)
      );
      return payload;
    }""", action)


def record_source_observation(page, fixture, claim):
    actor = authoritative_snapshot(page)
    actor_id = actor['viewerId']
    actor_role = actor['viewerRole']
    version = fixture.get('version', 1)
    note = {
        'claim': claim.strip(),
        'sourceKind': 'model-assertion',
        'source': 'Synthetic browser fixture; no primary source was retrieved.',
        'falsifier': 'A direct primary-source check contradicts this note.',
        'uncertainty': 'The primary source has not been retrieved.',
        'nextTest': 'Retrieve and inspect the primary source.'
    }
    # Mirror the public sourceObservationRequestMaterial canonical field order.
    # This creates an actor-bound note ID, not a source receipt or verification.
    material = json.dumps({
        'protocol': 'ngl.source-observation-id.v1',
        'actorId': actor_id,
        'actorRole': actor_role,
        'creationId': fixture['creationId'],
        'version': version,
        'claim': note['claim'],
        'sourceKind': note['sourceKind'],
        'source': note['source'],
        'falsifier': note['falsifier'],
        'uncertainty': note['uncertainty'],
        'nextTest': note['nextTest']
    }, ensure_ascii=False, separators=(',', ':'))
    observation_id = 'source-observation-' + hashlib.sha256(material.encode('utf-8')).hexdigest()
    action = {
        'type': 'record-source-observation',
        'creationId': fixture['creationId'],
        'version': version,
        'observationId': observation_id,
        **note,
        'requestId': observation_id
    }
    payload = post_action(page, action)
    assert payload.get('result', {}).get('observationId') == observation_id
    return {'observationId': observation_id, 'actorId': actor_id, 'actorRole': actor_role}


def shared_world_snapshot(snapshot):
    # publicWorld redacts draft/repair events and actor-private reports from some roles.
    # Only the mutually visible retained event surface is comparable across sessions.
    return {key: snapshot[key] for key in ('revision', 'xp', 'mutuallyVisibleEventIds', 'creationVersions')}


def assert_deliberator_character_record(page, role, expected_rounds, screenshot):
    before = authoritative_snapshot(page)
    assert before['viewerRole'] == role, 'Character Record must be inspected by the expected session actor.'
    character_button = page.locator('#character-button')
    expect(character_button).to_be_visible()
    character_button.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
        "!document.querySelector('#sheet').hidden",
        timeout=30000
    )
    skill = page.locator('#sheet-content [data-skill-id="deliberator"]')
    expect(skill).to_have_count(1)
    expect(skill.locator('h3')).to_have_text('Deliberator')
    expect(skill).to_contain_text(
        f'{expected_rounds} recorded completed current-guild Dissent Circuit rounds with own retained participation.'
    )
    expect(skill).to_contain_text('Counts only complete four-event rounds')
    expect(skill).to_contain_text('participation only')
    expect(skill).to_contain_text('LEADS_ONLY')
    expect(skill).to_contain_text('NOT_PERFORMED')

    after = authoritative_snapshot(page)
    assert shared_world_snapshot(after) == shared_world_snapshot(before), (
        'Opening the Character Record must be read-only; it cannot append events or change XP.'
    )
    page.screenshot(path=str(screenshot), full_page=True)
    page.locator('#sheet-close').tap()
    return {
        'role': role,
        'deliberatorRounds': expected_rounds,
        'readOnly': True,
        'xpUnchanged': after['xp'] == before['xp'],
        'screenshot': screenshot.name
    }


def run_guild_dissent_circuit(browser, founder_page, url, observatory_fixture, out):
    witness_context = browser.new_context(
        viewport={'width': 390, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    witness_page = witness_context.new_page()
    witness_errors = []
    witness_page.on('pageerror', lambda error: witness_errors.append(str(error)))
    try:
        witness_page.goto(url, wait_until='networkidle')
        witness_page.locator('#start-shared').tap()
        witness_page.locator('#world').wait_for(state='visible')
        witness_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )

        founder_before = authoritative_snapshot(founder_page)
        witness_before = authoritative_snapshot(witness_page)
        assert founder_before['viewerRole'] == 'founder'
        assert witness_before['viewerRole'] == 'witness'
        assert founder_before['viewerId'] != witness_before['viewerId'], (
            'The circuit requires two distinct actor identities, not two views of one session.'
        )

        guild_payload = post_action(founder_page, {
            'type': 'create-guild',
            'name': 'Quest Board Dissent Circuit',
            'charter': 'Preserve dissent; never promote model assertions to evidence.',
            'requestId': 'quest-board-guild-create'
        })
        guild_id = guild_payload.get('result', {}).get('guildId')
        assert isinstance(guild_id, str) and guild_id

        founder_note = record_source_observation(
            founder_page, observatory_fixture, 'Founder fixture claim: the model assertion is not verified.'
        )
        join_payload = post_action(witness_page, {
            'type': 'join-guild',
            'guildId': guild_id,
            'requestId': 'quest-board-guild-join'
        })
        assert join_payload.get('result', {}).get('guildId') == guild_id

        witness_note = record_source_observation(
            witness_page, observatory_fixture, 'Witness fixture claim: retrieval remains unperformed.'
        )
        challenge_payload = post_action(witness_page, {
            'type': 'challenge-source-observation',
            'observationId': founder_note['observationId'],
            'challengeType': 'missing-evidence',
            'challengeText': 'The model assertion has no retrieved primary source.',
            'requestId': 'quest-board-guild-challenge'
        })
        challenge_id = challenge_payload.get('result', {}).get('challengeId')
        assert isinstance(challenge_id, str) and challenge_id

        response_payload = post_action(founder_page, {
            'type': 'respond-source-observation-challenge',
            'challengeId': challenge_id,
            'responseText': 'Agreed: this remains a lead until the primary source is retrieved.',
            'requestId': 'quest-board-guild-response'
        })
        assert isinstance(response_payload.get('result', {}).get('responseId'), str)

        after_founder = authoritative_snapshot(founder_page)
        after_witness = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(after_founder) == shared_world_snapshot(after_witness), (
            'Separate Founder and Witness browser contexts must observe the same retained shared world.'
        )
        assert after_founder['xp'] == founder_before['xp'], (
            'Guild membership, observations, dissent and response award no XP.'
        )
        assert after_founder['revision'] == founder_before['revision'] + 6, (
            'Exactly six canonical actions should be retained; the quest projection itself appends no event.'
        )
        event_summary = founder_page.evaluate("""async () => {
          const response = await fetch('/api/state', {cache: 'no-store', credentials: 'same-origin'});
          if (!response.ok) throw new Error('Could not inspect the retained group-quest event trail.');
          const dto = await response.json();
          const events = dto.world.events;
          const count = type => events.filter(event => event.type === type).length;
          const observations = events.filter(event => event.type === 'source-observation-recorded');
          return {
            guildCreated: count('guild-created'),
            guildJoined: count('guild-joined'),
            observations: observations.map(event => ({
              actorId: event.actor.id,
              sourceRetrieval: event.sourceRetrieval,
              independentVerification: event.independentVerification,
              modelAssertions: event.modelAssertions
            })),
            challenges: count('source-observation-challenged'),
            responses: count('source-observation-challenge-responded')
          };
        }""")
        assert event_summary['guildCreated'] == 1
        assert event_summary['guildJoined'] == 1
        assert len(event_summary['observations']) == 2
        assert len({item['actorId'] for item in event_summary['observations']}) == 2
        assert all(item['sourceRetrieval'] == 'NOT_PERFORMED' for item in event_summary['observations'])
        assert all(item['independentVerification'] == 'NOT_PERFORMED' for item in event_summary['observations'])
        assert all(item['modelAssertions'] == 'LEADS_ONLY' for item in event_summary['observations'])
        assert event_summary['challenges'] == 1
        assert event_summary['responses'] == 1

        # A completed circuit must open a fresh round. New notes, challenge and
        # response are distinct retained actions; the first round is not reused.
        after_first_round = authoritative_snapshot(founder_page)
        founder_round_two_note = record_source_observation(
            founder_page, observatory_fixture, 'Founder round two: retrieval is still outstanding.'
        )
        witness_round_two_note = record_source_observation(
            witness_page, observatory_fixture, 'Witness round two: this source remains a lead only.'
        )
        round_two_challenge_payload = post_action(witness_page, {
            'type': 'challenge-source-observation',
            'observationId': founder_round_two_note['observationId'],
            'challengeType': 'missing-evidence',
            'challengeText': 'The second note still has no retrieved primary source.',
            'requestId': 'quest-board-guild-challenge-round-2'
        })
        round_two_challenge_id = round_two_challenge_payload.get('result', {}).get('challengeId')
        assert isinstance(round_two_challenge_id, str) and round_two_challenge_id
        round_two_response_payload = post_action(founder_page, {
            'type': 'respond-source-observation-challenge',
            'challengeId': round_two_challenge_id,
            'responseText': 'The challenge stands; retrieval is still outstanding.',
            'requestId': 'quest-board-guild-response-round-2'
        })
        assert isinstance(round_two_response_payload.get('result', {}).get('responseId'), str)

        after_second_founder = authoritative_snapshot(founder_page)
        after_second_witness = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(after_second_founder) == shared_world_snapshot(after_second_witness)
        assert after_second_founder['revision'] == after_first_round['revision'] + 4, (
            'A second circuit must retain exactly two new observations, one challenge and one response.'
        )
        assert after_second_founder['xp'] == founder_before['xp'], (
            'A repeat circuit records participation only and awards no XP.'
        )
        full_event_summary = founder_page.evaluate("""async () => {
          const response = await fetch('/api/state', {cache: 'no-store', credentials: 'same-origin'});
          if (!response.ok) throw new Error('Could not inspect the repeated circuit event trail.');
          const dto = await response.json();
          const events = dto.world.events;
          const count = type => events.filter(event => event.type === type).length;
          const observations = events.filter(event => event.type === 'source-observation-recorded');
          return {
            guildCreated: count('guild-created'),
            guildJoined: count('guild-joined'),
            observations: observations.map(event => ({
              id: event.id,
              actorId: event.actor.id,
              actorRole: event.actor.role,
              sourceRetrieval: event.sourceRetrieval,
              independentVerification: event.independentVerification,
              modelAssertions: event.modelAssertions
            })),
            challenges: count('source-observation-challenged'),
            responses: count('source-observation-challenge-responded')
          };
        }""")
        assert full_event_summary['guildCreated'] == 1
        assert full_event_summary['guildJoined'] == 1
        assert len(full_event_summary['observations']) == 4
        assert len({item['actorId'] for item in full_event_summary['observations']}) == 2
        assert all(item['sourceRetrieval'] == 'NOT_PERFORMED' for item in full_event_summary['observations'])
        assert all(item['independentVerification'] == 'NOT_PERFORMED' for item in full_event_summary['observations'])
        assert all(item['modelAssertions'] == 'LEADS_ONLY' for item in full_event_summary['observations'])
        assert full_event_summary['challenges'] == 2
        assert full_event_summary['responses'] == 2

        # Reload both independent contexts before inspecting the shared objective.
        founder_page.reload(wait_until='networkidle')
        founder_page.locator('#start-shared').tap()
        founder_page.locator('#world').wait_for(state='visible')
        founder_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
        witness_page.reload(wait_until='networkidle')
        witness_page.locator('#start-shared').tap()
        witness_page.locator('#world').wait_for(state='visible')
        witness_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        founder_persisted = authoritative_snapshot(founder_page)
        witness_persisted = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(founder_persisted) == shared_world_snapshot(witness_persisted)

        founder_before_board = authoritative_snapshot(founder_page)
        witness_before_board = authoritative_snapshot(witness_page)
        open_quest_board(founder_page)
        assert_board(founder_page, 'founder')
        assert_circuit_progress(founder_page, 'founder', '4/4', complete=True)
        assert_circuit_round_progress(founder_page, 'founder', 2, '4/4', complete=True)
        assert_circuit_round_progress(founder_page, 'founder', 3, '0/4', complete=False)
        founder_round_three = founder_page.locator(
            '#sheet-content [data-objective-id="founder-guild-dissent-circuit-3"]'
        )
        expect(founder_round_three.get_by_role('button', name='Go do this →', exact=True)).to_be_visible()
        founder_after_board = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(founder_after_board) == shared_world_snapshot(founder_before_board)

        open_quest_board(witness_page)
        assert_board(witness_page, 'witness')
        assert_circuit_progress(witness_page, 'witness', '4/4', complete=True)
        assert_circuit_round_progress(witness_page, 'witness', 2, '4/4', complete=True)
        assert_circuit_round_progress(witness_page, 'witness', 3, '0/4', complete=False)
        witness_after_board = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(witness_after_board) == shared_world_snapshot(witness_before_board)

        founder_screenshot = out / 'guild-dissent-circuit-founder-390.png'
        witness_screenshot = out / 'guild-dissent-circuit-witness-390.png'
        founder_page.screenshot(path=str(founder_screenshot), full_page=True)
        witness_page.screenshot(path=str(witness_screenshot), full_page=True)
        assert not witness_errors, 'Witness browser page errors: ' + json.dumps(witness_errors)

        founder_page.locator('#sheet-close').tap()
        witness_page.locator('#sheet-close').tap()

        # The same retained two-round circuit must appear in each participant's
        # actual Character Record, not only in the Quest Board or a unit fixture.
        founder_character = assert_deliberator_character_record(
            founder_page, 'founder', 2, out / 'deliberator-founder-390.png'
        )
        witness_character = assert_deliberator_character_record(
            witness_page, 'witness', 2, out / 'deliberator-witness-390.png'
        )
        assert founder_character['deliberatorRounds'] == witness_character['deliberatorRounds'] == 2
        assert founder_character['readOnly'] and witness_character['readOnly']
        assert founder_character['xpUnchanged'] and witness_character['xpUnchanged']
        assert not witness_errors, 'Witness browser page errors: ' + json.dumps(witness_errors)

        return {
            'passed': True,
            'twoSeparateBrowserContexts': True,
            'founderActorId': founder_before['viewerId'],
            'witnessActorId': witness_before['viewerId'],
            'guildId': guild_id,
            'sourceObservationIds': [founder_note['observationId'], witness_note['observationId']],
            'eventSummary': event_summary,
            'worldReloadRecovered': True,
            'sharedWorldConverged': True,
            'founderQuestProgress': '4/4',
            'witnessQuestProgress': '4/4',
            'completedRounds': 2,
            'nextRoundProgress': '0/4',
            'secondRoundObservationIds': [
                founder_round_two_note['observationId'], witness_round_two_note['observationId']
            ],
            'secondRoundEventSummary': full_event_summary,
            'noXpAwarded': after_second_founder['xp'] == founder_before['xp'],
            'boardInspectionReadOnly': True,
            'characterProjectionReadOnly': True,
            'founderCharacterRecord': founder_character,
            'witnessCharacterRecord': witness_character,
            'pageErrors': witness_errors,
            'screenshots': [
                founder_screenshot.name, witness_screenshot.name,
                founder_character['screenshot'], witness_character['screenshot']
            ]
        }
    finally:
        witness_context.close()


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
            observatory_fixture = publish_observatory_fixture(page)
            page.wait_for_function(
                "() => document.querySelector('#creation-count')?.textContent === '2' && "
                "document.querySelector('#xp-count')?.textContent === '200'"
            )
            guild_circuit_result = run_guild_dissent_circuit(
                browser, page, url, observatory_fixture, out
            )
        else:
            fixture = None
            observatory_fixture = None
            guild_circuit_result = None

        before = authoritative_snapshot(page)
        assert before['viewerRole'] == 'founder'
        open_quest_board(page)
        rows = assert_board(page, 'founder')
        assert_circuit_progress(page, 'founder', '4/4' if guild_circuit_result else '0/4', complete=bool(guild_circuit_result))
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
            'observatoryPublication': observatory_fixture,
            'guildDissentCircuit': guild_circuit_result,
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
