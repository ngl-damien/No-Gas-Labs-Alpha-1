"""Mobile acceptance for the actor-scoped, in-world Quest Board.

Three browser sessions share a repeatable Guild Dissent Circuit. The Source
Archive journey uses the real server action with a deterministic mocked GitHub
Contents API transport, proving the server-recheck path without external access.
A server-observed retrieval failure must remain searchable in the Evidence
Archive Chronicle for Founder and Witness without creating a draft or XP.
The fixed Contradiction Clerk is stationed at Evidence Archive; 320px Founder
and 390px Witness journeys use its two-step NPC approach/talk control, allow only
navigation discovery before interaction, and prove the focused challenge form
is read-only until explicit submission of one attributed report without XP or a verdict.
A separate 390px Founder journey proves a transient upstream failure preserves
the exact Relay request ID, then reconciles one private draft after recovery.
Character Record inspection is read-only at 320px and 390px.
"""
import argparse
import base64
import hashlib
import json
import math
import select
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE_FIXTURE_TEXT = "export const NGL_QUEST_BOARD_SERVER_RECHECK = 'fixture-only';\n"
SOURCE_FIXTURE_BYTES = SOURCE_FIXTURE_TEXT.encode('utf-8')
SOURCE_FIXTURE_REPOSITORY = 'ngl-damien/No-Gas-Labs-Alpha-1'
SOURCE_FIXTURE_COMMIT = 'f' * 40
SOURCE_FIXTURE_PATH = 'test/fixtures/quest-board-server-recheck.mjs'
SOURCE_FIXTURE_PERMALINK = (
    'https://github.com/' + SOURCE_FIXTURE_REPOSITORY + '/blob/' +
    SOURCE_FIXTURE_COMMIT + '/' + SOURCE_FIXTURE_PATH
)
SOURCE_FIXTURE_API_URL = (
    'https://api.github.com/repos/' + SOURCE_FIXTURE_REPOSITORY +
    '/contents/' + SOURCE_FIXTURE_PATH + '?ref=' + SOURCE_FIXTURE_COMMIT
)
SOURCE_FIXTURE_GIT_BLOB_SHA = hashlib.sha1(
    b'blob ' + str(len(SOURCE_FIXTURE_BYTES)).encode('ascii') + b'\0' + SOURCE_FIXTURE_BYTES
).hexdigest()
SOURCE_FIXTURE_SHA256 = hashlib.sha256(SOURCE_FIXTURE_BYTES).hexdigest()
SOURCE_FAILURE_PATH = 'test/fixtures/quest-board-source-unavailable.mjs'
SOURCE_FAILURE_PERMALINK = (
    'https://github.com/' + SOURCE_FIXTURE_REPOSITORY + '/blob/' +
    SOURCE_FIXTURE_COMMIT + '/' + SOURCE_FAILURE_PATH
)
SOURCE_FAILURE_API_URL = (
    'https://api.github.com/repos/' + SOURCE_FIXTURE_REPOSITORY +
    '/contents/' + SOURCE_FAILURE_PATH + '?ref=' + SOURCE_FIXTURE_COMMIT
)
SOURCE_FAILURE_GIT_BLOB_SHA = 'a' * 40
SOURCE_FAILURE_SHA256 = 'b' * 64
SOURCE_FAILURE_SIZE = 1
SOURCE_FAILURE_REQUEST_ID = 'quest-board-source-archive-failure'
SOURCE_FIXTURE_PAYLOAD = {
    'type': 'file',
    'encoding': 'base64',
    'path': SOURCE_FIXTURE_PATH,
    'size': len(SOURCE_FIXTURE_BYTES),
    'sha': SOURCE_FIXTURE_GIT_BLOB_SHA,
    'content': base64.b64encode(SOURCE_FIXTURE_BYTES).decode('ascii')
}
SOURCE_RETRY_PATH = 'test/fixtures/quest-board-source-retry.mjs'
SOURCE_RETRY_PERMALINK = (
    'https://github.com/' + SOURCE_FIXTURE_REPOSITORY + '/blob/' +
    SOURCE_FIXTURE_COMMIT + '/' + SOURCE_RETRY_PATH
)
SOURCE_RETRY_API_URL = (
    'https://api.github.com/repos/' + SOURCE_FIXTURE_REPOSITORY +
    '/contents/' + SOURCE_RETRY_PATH + '?ref=' + SOURCE_FIXTURE_COMMIT
)
SOURCE_RETRY_PAYLOAD = {
    'type': 'file',
    'encoding': 'base64',
    'path': SOURCE_RETRY_PATH,
    'size': len(SOURCE_FIXTURE_BYTES),
    'sha': SOURCE_FIXTURE_GIT_BLOB_SHA,
    'content': base64.b64encode(SOURCE_FIXTURE_BYTES).decode('ascii')
}
SERVER = """import {createGameServer} from './game/server.mjs';
import {writeFile} from 'node:fs/promises';
const fixture=JSON.parse(process.argv[2]);
let retryAttempts=0;
const githubSourceFetch=async (url,options={})=>{
  if(options?.method!=='GET' ||
      options?.redirect!=='error' ||
      options?.credentials!=='omit' ||
      options?.cache!=='no-store') {
    throw new Error('Unexpected Source Archive mock GitHub request');
  }
  if(url===fixture.failureApiUrl) {
    return new Response(JSON.stringify({message:'fixture upstream unavailable'}),{
      status:503,
      headers:{'content-type':'application/json'}
    });
  }
  if(url===fixture.retryApiUrl) {
    retryAttempts+=1;
    await writeFile(fixture.retryAttemptsPath,String(retryAttempts));
    if(retryAttempts===1) {
      return new Response(JSON.stringify({message:'fixture retry source temporarily unavailable'}),{
        status:503,
        headers:{'content-type':'application/json'}
      });
    }
    const retryBody=JSON.stringify(fixture.retryPayload);
    return new Response(retryBody,{status:200,headers:{
      'content-type':'application/json',
      'content-length':String(Buffer.byteLength(retryBody))
    }});
  }
  if(url!==fixture.apiUrl) throw new Error('Unexpected Source Archive mock GitHub URL');
  const body=JSON.stringify(fixture.payload);
  return new Response(body,{status:200,headers:{
    'content-type':'application/json',
    'content-length':String(Buffer.byteLength(body))
  }});
};
const server=await createGameServer({
  dataDir:process.argv[1],
  founderKey:'fake-browser-fixture-key-not-a-secret',
  githubSourceFetch
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.once('SIGTERM',()=>server.closeGame());"""


def launch_server(data_dir, retry_attempts_path):
    fixture = json.dumps({
        'apiUrl': SOURCE_FIXTURE_API_URL,
        'failureApiUrl': SOURCE_FAILURE_API_URL,
        'payload': SOURCE_FIXTURE_PAYLOAD,
        'retryApiUrl': SOURCE_RETRY_API_URL,
        'retryPayload': SOURCE_RETRY_PAYLOAD,
        'retryAttemptsPath': str(retry_attempts_path)
    }, separators=(',', ':'))
    process = subprocess.Popen(
        ['node', '--input-type=module', '-e', SERVER, str(data_dir), fixture],
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



def authoritative_player_position(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared position read failed: ' + response.status);
      const dto = await response.json();
      const position = dto?.viewer?.position;
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        throw new Error('Shared state did not contain an authoritative player position.');
      }
      return { x: position.x, y: position.y };
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



def enter_nearby_institution(page, place_id, accessible_name, title, timeout=30000):
    page.bring_to_front()
    aria_label = 'Enter ' + accessible_name
    try:
        page.wait_for_function(
            """expected => {
                const world = document.querySelector('#world');
                const sheet = document.querySelector('#sheet');
                const actionable = element => {
                    if (!element || element.hidden || element.disabled) return false;
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.pointerEvents !== 'none' &&
                        rect.width > 0 && rect.height > 0;
                };
                const enterButton = document.querySelector('#enter-institution-button');
                const primaryButton = document.querySelector('#interact-button');
                const separateEntry = actionable(enterButton) &&
                    enterButton.getAttribute('aria-label') === expected.ariaLabel;
                const primaryEntry = actionable(primaryButton) &&
                    primaryButton.getAttribute('aria-label') === expected.ariaLabel;
                return world?.dataset.nearbyInstitutionId === expected.placeId &&
                    ['idle', 'arrived'].includes(world?.dataset.navigationState) &&
                    sheet?.hidden === true &&
                    (separateEntry || primaryEntry);
            }""",
            arg={'placeId': place_id, 'ariaLabel': aria_label},
            timeout=timeout
        )
        # Resolve the unique accessible action rather than a comma-separated
        # CSS union. The HUD action and secondary entry control can share a
        # label while the renderer hides one; role lookup excludes hidden
        # controls and fails closed if more than one visible action exists.
        entry = page.get_by_role('button', name=aria_label, exact=True)
        expect(entry).to_have_count(1, timeout=timeout)
        expect(entry).to_be_visible(timeout=timeout)
        expect(entry).to_be_enabled(timeout=timeout)
        entry.tap(timeout=min(timeout, 8000))
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
          const describe = selector => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
              hidden: element.hidden,
              disabled: element.disabled,
              ariaLabel: element.getAttribute('aria-label'),
              display: style.display,
              visibility: style.visibility,
              pointerEvents: style.pointerEvents,
              width: rect.width,
              height: rect.height
            };
          };
          const world = document.querySelector('#world');
          return {
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
            modeLabel: document.querySelector('#mode-label')?.textContent ?? null,
            connectionState: document.querySelector('#connection-dot')?.dataset.connectionState ?? null,
            nearbyInstitutionId: world?.dataset.nearbyInstitutionId ?? null,
            navigationState: world?.dataset.navigationState ?? null,
            enterButton: describe('#enter-institution-button'),
            primaryButton: describe('#interact-button'),
            sheetHidden: document.querySelector('#sheet')?.hidden ?? null,
            sheetTitle: document.querySelector('#sheet-title')?.textContent ?? null,
            viewer
          };
        }""")
        raise AssertionError(
            f"Could not enter {accessible_name} ({place_id}) within {timeout}ms: " +
            json.dumps(diagnostics)
        ) from error
    page.wait_for_function(
        "(expected) => document.querySelector('#sheet-title')?.textContent === expected && " +
        "!document.querySelector('#sheet').hidden",
        arg=title,
        timeout=timeout
    )

def open_quest_board(page):
    page.bring_to_front()
    page.locator('#places-button').tap()
    route = page.get_by_role('button', name='Walk to Quest Board', exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, 'quest_board', 'Quest Board', 'Quest Board')


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
    for suffix in ('forge-contradiction-ward', 'equip-contradiction-ward'):
        expect(content.locator(f'[data-objective-id="{role}-{suffix}"]')).to_have_count(1)
    return rows




def inspect_quest_evidence_event(page, objective_id, event_id, expected_type, screenshot):
    row = page.locator(f'#sheet-content [data-objective-id="{objective_id}"]')
    expect(row).to_have_count(1)
    details = row.locator('details.quest-evidence')
    expect(details).to_have_count(1)
    details.locator('summary').tap()

    event_link = details.locator('[data-quest-evidence-event-link="' + event_id + '"]')
    expect(event_link).to_have_count(1)
    expect(event_link).to_have_attribute('data-chronicle-event-id', event_id)
    expect(event_link).to_have_attribute('data-chronicle-source', 'world')
    expect(event_link).to_have_attribute(
        'aria-label', 'Inspect retained ' + expected_type + ' event in World Chronicle'
    )

    board_snapshot_revision = page.locator('#sheet-content').get_attribute(
        'data-quest-board-snapshot-revision'
    )
    assert isinstance(board_snapshot_revision, str) and board_snapshot_revision.isdigit(), (
        'The Quest Board must expose the accepted client snapshot revision it projects.'
    )
    before = authoritative_snapshot(page)
    event_link.tap()
    expect(page.locator('#sheet-title')).to_have_text('World Chronicle')
    exact_event = page.locator('#sheet-content [data-event-id="world:' + event_id + '"]')
    expect(exact_event).to_have_count(1)
    expect(exact_event).to_have_attribute('data-event-source', 'world')
    expect(page.locator('#sheet-content')).to_have_attribute(
        'data-chronicle-snapshot-revision', board_snapshot_revision
    )
    after = authoritative_snapshot(page)
    assert shared_world_snapshot(after) == shared_world_snapshot(before), (
        'Opening quest evidence in World Chronicle must preserve the accepted world snapshot.'
    )
    assert after['xp'] == before['xp'], 'Quest evidence inspection must award no XP.'

    screenshot = Path(screenshot)
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        'objectiveId': objective_id,
        'eventId': event_id,
        'eventType': expected_type,
        'exactWorldEventOpened': True,
        'snapshotRevision': int(board_snapshot_revision),
        'serverRevisionAtInspection': before['revision'],
        'readOnly': shared_world_snapshot(after) == shared_world_snapshot(before),
        'xpDelta': after['xp'] - before['xp'],
        'screenshot': screenshot.name
    }


def assert_publication_chronicle_navigation(page, publication, out, width):
    # Publication House is a world location. Navigate there through the map,
    # then require the selected artifact version to resolve to one exact event.
    if not page.locator('#sheet').is_hidden():
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()
    page.bring_to_front()
    page.locator('#places-button').tap()
    route = page.get_by_role('button', name='Walk to Publication House', exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, 'publication_house', 'Publication House', 'Publication House')

    target = page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Publication House oracle could not read the accepted world.');
      const dto = await response.json();
      const creations = dto.world?.creations ?? [];
      const events = dto.world?.events ?? [];
      const matches = creations.filter(item => item?.id === expected.creationId);
      if (matches.length !== 1) throw new Error('The publication target is missing or ambiguous.');
      const creation = matches[0];
      const versions = [...(Array.isArray(creation.versions) ? creation.versions : []), creation]
        .filter(item => item?.version === expected.version);
      if (versions.length !== 1) throw new Error('The exact retained publication version is missing or ambiguous.');
      const version = versions[0];
      const publications = events.filter(event => event?.type === 'publish' &&
        event.creationId === expected.creationId && event.version === expected.version);
      if (publications.length !== 1 || publications[0].actor?.role !== 'founder' ||
          typeof publications[0].id !== 'string' || !publications[0].id ||
          publications[0].id.trim() !== publications[0].id ||
          publications[0].at !== version.publishedAt) {
        throw new Error('The exact artifact version does not have one unambiguous Founder publication event.');
      }
      return {
        title: creation.title,
        kind: creation.kind,
        version: version.version,
        eventId: publications[0].id,
        publishedAt: version.publishedAt
      };
    }""", publication)
    button_name = f"{target['title']} · {target['kind']} · v{target['version']}"
    artifact = page.get_by_role('button', name=button_name, exact=True)
    expect(artifact).to_have_count(1)
    artifact.tap()
    expect(page.locator('#sheet-title')).to_have_text(target['title'])
    expect(page.locator('#version-select')).to_have_value(str(target['version']))

    link = page.locator('#publication-chronicle-link')
    expect(link).to_have_count(1)
    expect(link).to_be_visible()
    expect(link).to_have_attribute('data-publication-chronicle-event-id', target['eventId'])
    expect(link).to_have_attribute('data-chronicle-event-id', target['eventId'])
    expect(link).to_have_attribute('data-chronicle-source', 'world')
    before = authoritative_snapshot(page)
    link.tap()
    expect(page.locator('#sheet-title')).to_have_text('World Chronicle')
    exact_event = page.locator('#sheet-content [data-event-id="world:' + target['eventId'] + '"]')
    expect(exact_event).to_have_count(1)
    expect(exact_event).to_have_attribute('data-event-source', 'world')
    expect(exact_event).to_contain_text('Publication recorded')
    expect(page.locator('#sheet-content')).to_have_attribute(
        'data-chronicle-snapshot-revision', str(before['revision'])
    )
    after = authoritative_snapshot(page)
    assert shared_world_snapshot(after) == shared_world_snapshot(before), (
        'Publication-to-Chronicle navigation must not mutate the shared world.'
    )
    assert after['xp'] == before['xp'], 'Publication inspection must award no XP.'
    screenshot = out / ('publication-chronicle-' + str(width) + '.png')
    page.screenshot(path=str(screenshot), full_page=True)
    page.locator('#sheet-close').tap()
    expect(page.locator('#sheet')).to_be_hidden()
    return {
        'journey': 'publication-house-to-world-chronicle-' + str(width),
        'creationId': publication['creationId'],
        'version': target['version'],
        'publicationEventId': target['eventId'],
        'exactWorldEventOpened': True,
        'readOnly': shared_world_snapshot(after) == shared_world_snapshot(before),
        'xpDelta': after['xp'] - before['xp'],
        'snapshotRevision': before['revision'],
        'screenshot': screenshot.name
    }


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


def open_quest_board_current(page, role, round_number, progress):
    open_quest_board(page)
    server = authoritative_snapshot(page)
    page.wait_for_function(
        "(expected) => Number(document.querySelector('#world')?.dataset.worldRevision) >= expected",
        arg=server['revision']
    )
    content = page.locator('#sheet-content')
    revision_text = content.get_attribute('data-quest-board-snapshot-revision')
    assert isinstance(revision_text, str) and revision_text.isdigit(), (
        'Quest Board must identify the accepted snapshot it actually projects.'
    )
    pinned_revision = int(revision_text)
    if pinned_revision < server['revision']:
        expect(content).to_have_attribute('data-quest-board-snapshot-freshness', 'refresh-required')
        refresh = content.locator('[data-quest-board-refresh]')
        expect(refresh).to_have_count(1)
        refresh.tap()
    elif pinned_revision > server['revision']:
        raise AssertionError('Quest Board snapshot is ahead of the server-accepted revision.')
    current = authoritative_snapshot(page)
    page.wait_for_function(
        "(expected) => document.querySelector('#sheet-content')?.dataset.questBoardSnapshotRevision === String(expected) && " +
        "document.querySelector('#sheet-content')?.dataset.questBoardSnapshotFreshness === 'current'",
        arg=current['revision']
    )
    assert_circuit_round_progress(page, role, round_number, progress, complete=False)
    assert int(content.get_attribute('data-quest-board-snapshot-revision')) == current['revision']
    return current


def assert_quest_board_snapshot_refresh(page, role, round_number, pinned_progress,
                                        accepted_revision, screenshot):
    content = page.locator('#sheet-content')
    expect(page.locator('#sheet-title')).to_have_text('Quest Board')
    expect(content).to_have_attribute('data-quest-board', 'true')
    expect(content).to_have_attribute('data-quest-board-snapshot-freshness', 'refresh-required')
    pinned_text = content.get_attribute('data-quest-board-snapshot-revision')
    assert isinstance(pinned_text, str) and pinned_text.isdigit()
    pinned_revision = int(pinned_text)
    assert pinned_revision < accepted_revision, (
        'A refreshable Quest Board must remain pinned to an older accepted snapshot.'
    )
    notice = content.locator('[data-quest-board-snapshot-notice]')
    expect(notice).to_have_count(1)
    expect(notice).to_contain_text('advanced to revision ' + str(accepted_revision))
    refresh = notice.locator('[data-quest-board-refresh]')
    expect(refresh).to_have_count(1)
    expect(refresh).to_be_visible()
    expect(page.locator('#connection-dot')).to_have_attribute('data-connection-state', 'online')
    assert_circuit_round_progress(page, role, round_number, pinned_progress, complete=False)

    before = authoritative_snapshot(page)
    assert before['revision'] == accepted_revision
    api_requests = []

    def capture_request(request):
        if request.resource_type in ('fetch', 'xhr') and '/api/' in request.url:
            api_requests.append(request.url)

    page.on('request', capture_request)
    try:
        refresh.tap()
    finally:
        page.remove_listener('request', capture_request)

    refreshed = page.locator('#sheet-content')
    expect(refreshed).to_have_attribute('data-quest-board-snapshot-revision', str(accepted_revision))
    expect(refreshed).to_have_attribute('data-quest-board-snapshot-freshness', 'current')
    expect(refreshed.locator('[data-quest-board-snapshot-notice]')).to_have_count(0)
    assert_circuit_round_progress(page, role, round_number, '4/4', complete=True)
    after = authoritative_snapshot(page)
    assert shared_world_snapshot(after) == shared_world_snapshot(before), (
        'Refreshing the Quest Board must not mutate the accepted world snapshot.'
    )
    assert after['xp'] == before['xp'], 'Refreshing quest progress must award no XP.'
    assert not api_requests, (
        'Refreshing from the latest accepted in-memory snapshot must issue no shared API request: ' +
        json.dumps(api_requests)
    )
    assert after['revision'] == before['revision']
    screenshot = Path(screenshot)
    page.screenshot(path=str(screenshot), full_page=True)
    receipt = {
        'role': role,
        'round': round_number,
        'viewportWidth': page.evaluate('() => window.innerWidth'),
        'pinnedRevision': pinned_revision,
        'acceptedRevision': accepted_revision,
        'pinnedProgress': pinned_progress,
        'refreshedProgress': '4/4',
        'readOnly': shared_world_snapshot(after) == shared_world_snapshot(before),
        'xpDelta': after['xp'] - before['xp'],
        'sharedApiRequestsDuringRefresh': len(api_requests),
        'screenshot': screenshot.name
    }
    screenshot.with_suffix('.json').write_text(json.dumps(receipt, indent=2))
    return receipt


def assert_contradiction_ward_objectives(page, role, progress):
    for suffix in ('forge-contradiction-ward', 'equip-contradiction-ward'):
        row = page.locator(f'#sheet-content [data-objective-id="{role}-{suffix}"]')
        expect(row).to_have_count(1)
        expect(row).to_contain_text(progress)


def assert_carry_forward_objective(page, role, progress):
    row = page.locator(
        f'#sheet-content [data-objective-id="{role}-carry-field-item-forward"]'
    )
    expect(row).to_have_count(1)
    expect(row).to_contain_text('Carry a field item onward to another player')
    expect(row).to_contain_text(progress)
    expect(row.locator('.quest-step-state')).to_have_text(
        'RECORDED' if progress == '1/1' else 'OPEN'
    )


def assert_armor_bearer_delivery_objective(page, role, progress, complete=False):
    row = page.locator(
        f'#sheet-content [data-objective-id="{role}-armor-bearer-delivery"]'
    )
    expect(row).to_have_count(1)
    expect(row).to_contain_text('Complete a four-step Armor Bearer handoff')
    expect(row).to_contain_text(progress)
    expect(row.locator('.quest-step-state')).to_have_text('RECORDED' if complete else 'OPEN')


def assert_armor_bearer_chain_objective(page, role, last_event_id, progress, complete=False):
    row = page.locator(
        f'#sheet-content [data-objective-id="{role}-armor-bearer-chain-{last_event_id}"]'
    )
    expect(row).to_have_count(1)
    expect(row).to_contain_text(progress)
    expect(row.locator('.quest-step-state')).to_have_text('RECORDED' if complete else 'OPEN')
    return row


def assert_source_archive_objectives(page, role, proposal_progress, experiment_progress, predicate_progress='0/1', contrast_progress='0/2'):
    proposal = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-moonshot"]'
    )
    expect(proposal).to_have_count(1)
    expect(proposal).to_contain_text('Ground a falsifiable Moonshot in a published Source Archive')
    expect(proposal).to_contain_text(proposal_progress)
    expect(proposal.locator('.quest-step-state')).to_have_text(
        'RECORDED' if proposal_progress == '1/1' else 'OPEN'
    )
    expect(proposal).to_contain_text('server-rechecked')
    expect(proposal).to_contain_text('independent verification')
    expect(proposal).to_contain_text('truth')

    experiment = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-experiment"]'
    )
    expect(experiment).to_have_count(1)
    expect(experiment).to_contain_text('Use the same Source Archive in a retained experiment attempt')
    expect(experiment).to_contain_text(experiment_progress)
    expect(experiment.locator('.quest-step-state')).to_have_text(
        'RECORDED' if experiment_progress == '1/1' else 'OPEN'
    )
    expect(experiment).to_contain_text(
        'A failed or inconclusive self-report still records an attempt'
    )
    expect(experiment).to_contain_text('does not verify the procedure')

    predicate = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-predicate"]'
    )
    expect(predicate).to_have_count(1)
    expect(predicate).to_contain_text('Test a bounded predicate against server-rechecked Source Archive bytes')
    expect(predicate).to_contain_text(predicate_progress)
    expect(predicate.locator('.quest-step-state')).to_have_text(
        'RECORDED' if predicate_progress == '1/1' else 'OPEN'
    )
    expect(predicate).to_contain_text('MATCH/NO_MATCH describes only that byte test')
    if predicate_progress == '0/1':
        expect(predicate.get_by_role('button', name='Go do this →', exact=True)).to_be_visible()

    contrast = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-contrast"]'
    )
    expect(contrast).to_have_count(1)
    expect(contrast).to_contain_text('Compare both literal operators against one Source Archive version')
    expect(contrast).to_contain_text(contrast_progress)
    expect(contrast.locator('.quest-step-state')).to_have_text(
        'RECORDED' if contrast_progress == '2/2' else 'OPEN'
    )
    expect(contrast).to_contain_text('same exact literal')
    expect(contrast).to_contain_text('opposite (one MATCH and one NO_MATCH)')
    expect(contrast).to_contain_text('same exact published server-rechecked Source Archive version')
    expect(contrast).to_contain_text('do not adjudicate a claim')



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
        'World action ' + action.type + ' failed (' + response.status + '): ' + JSON.stringify(payload)
      );
      return payload;
    }""", action)


def publish_source_archive_fixture(page):
    # The browser uses the real shared action route. Only its GitHub transport is
    # mocked, so this proves the server-recheck path without external network access.
    draft = post_action(page, {
        'type': 'draft-github-source-archive',
        'permalink': SOURCE_FIXTURE_PERMALINK,
        'gitBlobSha': SOURCE_FIXTURE_GIT_BLOB_SHA,
        'sha256': SOURCE_FIXTURE_SHA256,
        'size': len(SOURCE_FIXTURE_BYTES),
        'requestId': 'quest-board-source-archive-draft'
    })
    draft_id = draft.get('result', {}).get('draftId')
    assert isinstance(draft_id, str) and draft_id, (
        'The server-rechecked Source Archive action must return its retained draft ID.'
    )
    publication = post_action(page, {
        'type': 'publish',
        'draftId': draft_id,
        'expectedVersion': 0,
        'requestId': 'quest-board-source-archive-publish'
    })
    result = publication.get('result', {})
    assert isinstance(result.get('creationId'), str) and result['creationId'], (
        'Server-rechecked Source Archive publication must return its retained creation ID.'
    )
    assert result.get('version') == 1, 'The acceptance fixture must publish version 1.'
    return {
        'creationId': result['creationId'],
        'version': 1,
        'sourceRetrieval': 'SERVER_RECHECKED_MOCK_FIXTURE',
        'sourceTransport': 'MOCK_GITHUB_CONTENTS_API',
        'independentVerification': 'NOT_PERFORMED',
        'repository': SOURCE_FIXTURE_REPOSITORY,
        'commitSha': SOURCE_FIXTURE_COMMIT,
        'path': SOURCE_FIXTURE_PATH,
        'permalink': SOURCE_FIXTURE_PERMALINK,
        'gitBlobSha': SOURCE_FIXTURE_GIT_BLOB_SHA,
        'sha256': SOURCE_FIXTURE_SHA256,
        'size': len(SOURCE_FIXTURE_BYTES),
        'bytesBase64': SOURCE_FIXTURE_PAYLOAD['content'],
        'fixtureOnly': True
    }



def record_source_archive_failure(page):
    result = page.evaluate("""async expected => {
      const readWorld = async () => {
        const response = await fetch('/api/state', {
          cache: 'no-store',
          credentials: 'same-origin'
        });
        if (!response.ok) throw new Error('Shared state read failed: ' + response.status);
        const dto = await response.json();
        if (!dto?.world || !Array.isArray(dto.world.events) ||
            !Array.isArray(dto.world.drafts) || !Array.isArray(dto.world.creations)) {
          throw new Error('Shared world projection is incomplete.');
        }
        return dto.world;
      };
      const before = await readWorld();
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'draft-github-source-archive',
          permalink: expected.permalink,
          gitBlobSha: expected.gitBlobSha,
          sha256: expected.sha256,
          size: expected.size,
          requestId: expected.requestId
        })
      });
      const payload = await response.json();
      if (response.status !== 502 || payload.error?.code !== 'GITHUB_SOURCE_UNAVAILABLE') {
        throw new Error('Expected the bounded mock GitHub outage, received ' +
          response.status + ': ' + JSON.stringify(payload));
      }
      const after = await readWorld();
      const failures = after.events.filter(event => event.type === 'source-archive-attempt-failed');
      if (failures.length !== 1) throw new Error('Expected exactly one retained Source Archive failure event.');
      const event = failures[0];
      if (event.actor?.id !== 'damien' || event.actor?.role !== 'founder' ||
          event.failureCode !== 'GITHUB_SOURCE_UNAVAILABLE' || event.retryable !== true ||
          event.repository !== expected.repository || event.commitSha !== expected.commitSha ||
          event.path !== expected.path || event.observedBy !== 'shared-source-archive-service' ||
          !/^[a-f0-9]{64}$/.test(event.requestIdDigest || '') ||
          !/^[a-f0-9]{64}$/.test(event.actionDigest || '') ||
          Object.hasOwn(event, 'requestId') || Object.hasOwn(event, 'actionFingerprint') ||
          Object.hasOwn(event, 'actionResult') || JSON.stringify(event).includes(expected.requestId)) {
        throw new Error('Retained failure event has an unexpected actor, source, retry or idempotency shape.');
      }
      if (after.revision !== before.revision + 1 ||
          after.events.length !== before.events.length + 1 ||
          after.drafts.length !== before.drafts.length ||
          after.creations.length !== before.creations.length ||
          after.xp !== before.xp) {
        throw new Error('A failed retrieval must add one Chronicle event only, with no draft, publication or XP.');
      }
      return {
        eventId: event.id,
        attemptId: event.attemptId,
        failureCode: event.failureCode,
        retryable: event.retryable,
        revision: after.revision,
        xp: after.xp
      };
    }""", {
        'permalink': SOURCE_FAILURE_PERMALINK,
        'gitBlobSha': SOURCE_FAILURE_GIT_BLOB_SHA,
        'sha256': SOURCE_FAILURE_SHA256,
        'size': SOURCE_FAILURE_SIZE,
        'requestId': SOURCE_FAILURE_REQUEST_ID,
        'repository': SOURCE_FIXTURE_REPOSITORY,
        'commitSha': SOURCE_FIXTURE_COMMIT,
        'path': SOURCE_FAILURE_PATH
    })
    assert isinstance(result.get('eventId'), str) and result['eventId']
    assert result.get('failureCode') == 'GITHUB_SOURCE_UNAVAILABLE'
    assert result.get('retryable') is True
    return result


def open_evidence_archive(page):
    page.bring_to_front()
    page.locator('#places-button').tap()
    route = page.get_by_role('button', name='Walk to Evidence Archive', exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, 'evidence_archive', 'Evidence Archive', 'Evidence Archive')


def assert_source_observation_queue_mobile(page, challenge_id, challenge_event_id, creation_id,
                                           expected_claim, expected_challenge_text, screenshot):
    # Wait until this client's accepted shared snapshot includes the server-retained challenge.
    snapshot = authoritative_snapshot(page)
    page.wait_for_function(
        "expected => Number(document.querySelector('#world')?.dataset.worldRevision) >= expected",
        arg=snapshot['revision']
    )
    open_evidence_archive(page)
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    card = page.locator(
        '#sheet-content [data-record-type="SOURCE_OBSERVATION_PENDING_CHALLENGE"]'
    )
    expect(card).to_have_count(1)
    card = card.first
    expect(card).to_have_attribute('data-challenge-id', challenge_id)
    expect(card).to_have_attribute('data-ordering-basis', 'retained-append-position')

    accepted = authoritative_snapshot(page)
    try:
        expected_position = accepted['eventIds'].index(challenge_event_id) + 1
    except ValueError as error:
        raise AssertionError(
            "The challenge card must link to an event in this client accepted world stream."
        ) from error
    assert expected_position > 0
    expect(card).to_have_attribute('data-history-position', str(expected_position))
    expect(card).to_contain_text('WORLD STREAM · APPEND POSITION ' + str(expected_position))
    expect(card).to_contain_text(expected_claim)
    expect(card).to_contain_text(expected_challenge_text)
    expect(card).to_contain_text('Only the original note author can respond.')
    expect(card).to_contain_text('not a verdict, independent evidence, or authority')
    expect(card.locator('img')).to_have_count(0, timeout=5000)

    open_button = card.locator(
        '[data-source-observation-pending-challenge="' + challenge_id + '"]'
    )
    expect(open_button).to_have_count(1)
    expect(open_button).to_have_attribute('data-creation-id', creation_id)
    expect(open_button).to_have_attribute('data-version', '1')
    expect(card.get_by_role('button')).to_have_count(1)

    after = authoritative_snapshot(page)
    assert after == accepted, (
        'Inspecting the mobile response queue must not append events, change XP, or mutate the accepted world.'
    )
    viewport_width = page.evaluate("() => window.innerWidth")
    if viewport_width == 320:
        assert page.evaluate(
            "() => document.documentElement.scrollWidth <= window.innerWidth"
        ), 'The 320px Evidence Archive queue must not create horizontal overflow.'
    screenshot = Path(screenshot)
    page.screenshot(path=str(screenshot), full_page=True)
    page.locator('#sheet-close').tap()
    return {
        'visible': True,
        'challengeId': challenge_id,
        'challengeEventId': challenge_event_id,
        'creationId': creation_id,
        'version': 1,
        'historyPosition': expected_position,
        'orderingBasis': 'retained-append-position',
        'originalAuthorOnlyResponseBoundaryVisible': True,
        'noVerdictOrAuthorityClaim': True,
        'readOnly': after == accepted,
        'xpDelta': after['xp'] - accepted['xp'],
        'viewportWidth': viewport_width,
        'screenshot': screenshot.name
    }


def contradiction_clerk_snapshot(page, creation_id):
    return page.evaluate("""async creationId => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Contradiction Clerk state read failed: ' + response.status);
      const dto = await response.json();
      const world = dto?.world;
      if (!world || !Array.isArray(world.events) || !Array.isArray(world.reports)) {
        throw new Error('Contradiction Clerk snapshot is incomplete.');
      }
      return {
        revision: world.revision,
        xp: world.xp,
        viewerId: dto.viewer?.id,
        viewerRole: dto.viewer?.role,
        eventIds: world.events.map(event => event.id),
        actorEventIds: world.events.filter(event =>
          event.actor?.id === dto.viewer?.id && event.creationId === creationId
        ).map(event => event.id),
        events: world.events.map(event => ({
          id: event.id,
          type: event.type,
          creationId: event.creationId,
          version: event.version,
          actor: event.actor
        })),
        reports: world.reports.filter(report =>
          report.creationId === creationId && report.actor?.id === dto.viewer?.id
        ).map(report => ({
          id: report.id,
          creationId: report.creationId,
          version: report.version,
          text: report.text,
          actor: report.actor
        }))
      };
    }""", creation_id)


def run_contradiction_clerk_mobile_journey(page, archive, out, viewport_width, expected_role):
    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').tap()

    page.locator('#places-button').tap()
    guild_route = page.get_by_role('button', name='Walk to Guild Hall', exact=True)
    expect(guild_route).to_be_visible()
    guild_route.tap()
    enter_nearby_institution(page, 'guild_hall', 'Guild Hall', 'Guild Hall')
    expect(page.locator('#sheet-content [data-local-npc-role="contradiction-clerk"]')).to_have_count(0)
    page.locator('#sheet-close').tap()

    origin = page.evaluate('() => location.origin')
    external_requests = []
    def record_external_request(request):
        if request.url.startswith(('http://', 'https://')) and not request.url.startswith(origin):
            external_requests.append(request.url)
    page.on('request', record_external_request)

    # Exercise the actual NPC route, not a direct building shortcut. The first
    # action only approaches the fixed Clerk; a second explicit Talk action
    # opens the owning Evidence Archive and focuses its workbench.
    clerk_control = page.locator('[data-guild-npc-control="contradiction-clerk"]')
    expect(clerk_control).to_have_count(1)
    clerk_control.evaluate("(button) => button.focus()")
    expect(clerk_control).to_be_visible()
    expect(clerk_control).to_be_enabled()
    expect(clerk_control).to_have_attribute('data-guild-npc-action', 'approach')
    expect(clerk_control).to_contain_text('CLERK · EVIDENCE ARCHIVE')

    before_route = contradiction_clerk_snapshot(page, archive['creationId'])
    assert before_route['viewerRole'] == expected_role
    clerk_control.tap()
    page.wait_for_function(
        """() => {
          const control = document.querySelector('[data-guild-npc-control="contradiction-clerk"]');
          const world = document.querySelector('#world');
          return control?.dataset.guildNpcAction === 'talk' &&
            control.disabled === false &&
            world?.dataset.nearbyNpcRole === 'contradiction-clerk' &&
            document.querySelector('#sheet')?.hidden === true;
        }""",
        timeout=45000
    )
    after_route = contradiction_clerk_snapshot(page, archive['creationId'])
    route_events = [
        event for event in after_route['events']
        if event['id'] not in before_route['eventIds']
    ]
    assert all(
        event['type'] == 'discover' and
        (event.get('actor') or {}).get('id') == before_route['viewerId'] and
        (event.get('actor') or {}).get('role') == expected_role
        for event in route_events
    ), 'NPC approach may retain only this actor\'s legitimate navigation discoveries.'
    assert after_route['xp'] == before_route['xp'], (
        'Approaching the Clerk is navigation, not XP-bearing activity.'
    )
    assert after_route['actorEventIds'] == before_route['actorEventIds']
    assert after_route['reports'] == before_route['reports'], (
        'Approaching the Clerk must not submit a report.'
    )

    # The first action must not open the workbench. Re-focus the accessible
    # control after movement because the route temporarily disables the group.
    clerk_control.evaluate("(button) => button.focus()")
    expect(clerk_control).to_be_visible()
    expect(clerk_control).to_be_enabled()
    expect(clerk_control).to_have_attribute('data-guild-npc-action', 'talk')
    expect(clerk_control).to_contain_text('Talk · CLERK · EVIDENCE ARCHIVE')
    clerk_control.tap()
    page.wait_for_function(
        """() => document.querySelector('#sheet-title')?.textContent === 'Evidence Archive' &&
          document.querySelector('#sheet')?.hidden === false &&
          document.querySelector('#contradiction-clerk-npc')?.isConnected === true
        """,
        timeout=15000
    )
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    clerk = page.locator('#sheet-content [data-local-npc-role="contradiction-clerk"]')
    expect(clerk).to_have_count(1)
    expect(clerk).to_contain_text('BOUNDED ADVERSARY')
    expect(clerk).to_contain_text('No AI/provider call occurs.')
    focused_card = page.evaluate('() => document.activeElement?.id || null')
    assert focused_card == 'contradiction-clerk-npc', (
        'Talking to the Clerk must focus the exact workbench in its owning institution.'
    )
    after_talk = contradiction_clerk_snapshot(page, archive['creationId'])
    assert after_talk['revision'] == after_route['revision']
    assert after_talk['eventIds'] == after_route['eventIds']
    assert after_talk['xp'] == after_route['xp']
    assert after_talk['reports'] == after_route['reports'], (
        'The explicit Talk action opens the workbench but does not submit a report.'
    )

    target = page.evaluate("""async creationId => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Contradiction Clerk target read failed: ' + response.status);
      const dto = await response.json();
      const creation = dto.world?.creations?.find(item => item.id === creationId);
      return creation ? { title: creation.title, version: creation.version } : null;
    }""", archive['creationId'])
    assert target and target['version'] == archive['version'], (
        'The Clerk must challenge the exact retained published Source Archive version.'
    )
    challenge = clerk.get_by_role(
        'button',
        name='Challenge ' + target['title'] + ' · v' + str(target['version']) + ' →',
        exact=True
    )
    expect(challenge).to_be_visible()

    before = after_talk
    assert before['viewerRole'] == expected_role
    challenge.tap()
    expect(page.locator('#contradiction-form')).to_be_visible()
    expect(page.locator('#contradiction-submit')).to_be_visible()
    report_marker = f'NGL_CLERK_MOBILE_ACCEPTANCE_{expected_role.upper()}_{viewport_width}'
    page.locator('#contradiction-claim').fill(
        'The pinned Source Archive fixture contains its declared literal. ' + report_marker
    )
    page.locator('#contradiction-source').fill(
        'The exact published Source Archive version and its retained byte receipt.'
    )
    page.locator('#contradiction-falsifier').fill(
        'A fresh byte read that does not contain the exact literal.'
    )
    page.locator('#contradiction-unknown').fill(
        'Whether the underlying proposition is true beyond this byte test.'
    )
    after_fill = contradiction_clerk_snapshot(page, archive['creationId'])
    assert after_fill['xp'] == before['xp']
    assert after_fill['actorEventIds'] == before['actorEventIds']
    assert after_fill['reports'] == before['reports'], (
        'Opening and filling the fixed local challenge form must not create this actor\'s report or event.'
    )

    page.locator('#contradiction-submit').tap()
    page.wait_for_function(
        """async expected => {
          const response = await fetch('/api/state', {
            cache: 'no-store',
            credentials: 'same-origin'
          });
          if (!response.ok) return false;
          const dto = await response.json();
          return dto.viewer?.id === expected.actorId &&
            dto.viewer?.role === expected.actorRole &&
            Array.isArray(dto.world?.reports) &&
            dto.world.reports.some(report =>
              report.creationId === expected.creationId &&
              report.version === expected.version &&
              report.actor?.id === expected.actorId &&
              report.actor?.role === expected.actorRole &&
              typeof report.text === 'string' &&
              report.text.includes(expected.marker)
            );
        }""",
        arg={
            'actorId': before['viewerId'],
            'actorRole': expected_role,
            'creationId': archive['creationId'],
            'version': archive['version'],
            'marker': report_marker
        },
        timeout=15000
    )
    expect(page.locator('#creation-notes')).to_contain_text(report_marker)
    expect(page.locator('#creation-notes')).to_contain_text('REPORT ONLY — NOT A VERDICT.')
    after = contradiction_clerk_snapshot(page, archive['creationId'])
    before_report_ids = {report['id'] for report in before['reports']}
    new_reports = [report for report in after['reports'] if report['id'] not in before_report_ids]
    new_actor_report_events = [
        event for event in after['events']
        if event['id'] not in before['eventIds'] and
        (event.get('actor') or {}).get('id') == before['viewerId'] and
        event['creationId'] == archive['creationId'] and
        event['type'] == 'report' and
        event['version'] == archive['version']
    ]
    assert after['revision'] > before['revision'], 'The explicit report must advance the shared world revision.'
    assert after['xp'] == before['xp'], 'The Clerk report must award zero XP.'
    assert len(new_actor_report_events) == 1, (
        'Only one report event by this actor may be appended for the exact retained version.'
    )
    report_event = new_actor_report_events[0]
    assert report_event['creationId'] == archive['creationId']
    assert report_event['version'] == archive['version']
    assert report_event['actor']['id'] == before['viewerId']
    assert report_event['actor']['role'] == expected_role
    assert len(new_reports) == 1, 'The explicit submission must retain exactly one attributed report.'
    report = new_reports[0]
    assert report['creationId'] == archive['creationId']
    assert report['version'] == archive['version']
    assert report['actor']['id'] == before['viewerId']
    assert report['actor']['role'] == expected_role
    assert report_marker in report['text']
    assert 'REPORT ONLY — NOT A VERDICT.' in report['text']
    assert 'Receipt = bytes, not truth; no AI/provider call or independent observation occurred.' in report['text']
    assert external_requests == [], (
        'The fixed local Contradiction Clerk must not make an external provider/network call.'
    )

    screenshot = out / ('contradiction-clerk-evidence-archive-' + str(viewport_width) + '.png')
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        'npcRole': 'contradiction-clerk',
        'owningInstitution': 'evidence_archive',
        'guildHallDoesNotRenderClerk': True,
        'evidenceArchiveRendersClerk': True,
        'npcApproachAction': 'approach',
        'npcTalkAction': 'talk',
        'npcNavigationDiscoveryEventIds': [event['id'] for event in route_events],
        'npcNavigationOnlyDiscoveries': all(event['type'] == 'discover' for event in route_events),
        'npcNavigationXpUnchanged': after_route['xp'] == before_route['xp'],
        'npcTalkOpensOwningInstitution': True,
        'npcWorkbenchFocused': focused_card == 'contradiction-clerk-npc',
        'npcTalkReadOnly': (
            after_talk['revision'] == after_route['revision'] and
            after_talk['eventIds'] == after_route['eventIds'] and
            after_talk['xp'] == after_route['xp'] and
            after_talk['reports'] == after_route['reports']
        ),
        'viewerRole': expected_role,
        'creationId': archive['creationId'],
        'version': archive['version'],
        'reportEventId': report_event['id'],
        'reportId': report['id'],
        'reportActorId': report['actor']['id'],
        'reportActorRole': report['actor']['role'],
        'reportMarker': report_marker,
        'waitedForActorScopedReport': True,
        'readOnlyBeforeSubmit': (
            after_fill['xp'] == before['xp'] and
            after_fill['actorEventIds'] == before['actorEventIds'] and
            after_fill['reports'] == before['reports']
        ),
        'oneExplicitReportEvent': len(new_actor_report_events) == 1,
        'xpUnchanged': after['xp'] == before['xp'],
        'noVerdict': 'REPORT ONLY — NOT A VERDICT.' in report['text'],
        'noExternalProviderRequest': not external_requests,
        'screenshot': screenshot.name
    }


def assert_source_archive_failure_chronicle(page, failure, expected_role):
    # The direct API fixture deliberately bypasses the page's act() helper.
    # Reload the same authenticated session so the Chronicle is rendered from
    # a fresh shared-world snapshot rather than a stale in-memory projection.
    page.reload(wait_until='networkidle')
    page.locator('#start-shared').tap()
    page.locator('#world').wait_for(state='visible')
    expected_mode = 'Founder' if expected_role == 'founder' else 'Witness'
    page.wait_for_function(
        "(expected) => document.querySelector('#mode-label')?.textContent.includes(expected)",
        arg=expected_mode
    )
    before = authoritative_snapshot(page)
    assert before['viewerRole'] == expected_role, 'Failure Chronicle must be inspected by the intended actor.'
    assert failure['eventId'] in before['eventIds'], (
        'The exact server-retained failure event must be present in the fresh shared-world snapshot.'
    )
    open_evidence_archive(page)
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    # Entering the institution may update the session's retained player position.
    # Pin the inspection baseline only after navigation so this assertion measures
    # Chronicle reading/searching, not the legitimate route into Evidence Archive.
    before_inspection = authoritative_snapshot(page)
    assert before_inspection['viewerRole'] == expected_role
    assert failure['eventId'] in before_inspection['eventIds']
    search = page.locator('#sheet-content [data-chronicle-search]')
    expect(search).to_have_count(1)
    # Chronicle pages are bounded to 20 entries. Search spans the full retained
    # projection, so a new failure may be discoverable without being on page 1.
    search.fill('GITHUB_SOURCE_UNAVAILABLE')
    card = page.locator(
        '#sheet-content [data-chronicle-entries] [data-event-id="world:' +
        failure['eventId'] + '"]'
    )
    expect(card).to_have_count(1, timeout=15000)
    expect(card).to_contain_text('Source Archive attempt failed · GITHUB_SOURCE_UNAVAILABLE')
    expect(card).to_contain_text('The same request can be retried')
    expect(card).to_contain_text('Retryable: yes')
    expect(card).to_contain_text('does not establish source truth')
    search.fill('no-such-source-archive-failure')
    expect(card).to_have_count(0)
    expect(page.locator('#sheet-content [data-chronicle-page-status]')).to_contain_text(
        'No retained entries match'
    )
    search.fill('GITHUB_SOURCE_UNAVAILABLE')
    expect(card).to_have_count(1)
    after = authoritative_snapshot(page)
    assert after == before_inspection, 'Reading/searching the failure Chronicle must not mutate world state or XP.'
    page.locator('#sheet-close').tap()
    page.wait_for_function("() => document.querySelector('#sheet')?.hidden === true")
    return {
        'viewerRole': expected_role,
        'eventId': failure['eventId'],
        'visible': True,
        'searchable': True,
        'readOnly': True,
        'xpDelta': after['xp'] - before['xp']
    }


def source_archive_research_snapshot(page, actor_id, actor_role, archive, proposal_title, require_report):
    return page.evaluate("""async expected => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Source Archive research state read failed: ' + response.status);
      const dto = await response.json();
      const world = dto?.world;
      if (!world || !Array.isArray(world.events) || !Array.isArray(world.creations)) {
        throw new Error('Source Archive research state is incomplete.');
      }
      const creationMatches = world.creations.filter(item => item?.id === expected.archiveId);
      if (creationMatches.length !== 1) throw new Error('Expected one published Source Archive creation.');
      const creation = creationMatches[0];
      const versions = [...(Array.isArray(creation.versions) ? creation.versions : []), creation]
        .filter(version => version?.version === 1);
      if (versions.length !== 1) throw new Error('Source Archive version identity is ambiguous.');
      const version = versions[0];
      const intent = version.intent;
      const html = version.html;
      const receiptDigest = version.receipt?.digest;
      const metadataTag = '<script type="application/json" id="ngl-source-archive-data">';
      const metadataStart = typeof html === 'string' ? html.indexOf(metadataTag) : -1;
      const jsonStart = metadataStart < 0 ? -1 : metadataStart + metadataTag.length;
      const jsonEnd = jsonStart < 0 ? -1 : html.indexOf('</script>', jsonStart);
      const metadata = jsonEnd > jsonStart ? JSON.parse(html.slice(jsonStart, jsonEnd)) : null;
      if ((version.kind ?? creation.kind) !== 'custom' ||
          typeof intent !== 'string' || !intent.startsWith('NGL_GITHUB_SOURCE_ARCHIVE_V1') ||
          !intent.includes('Server-rechecked public GitHub bytes') ||
          typeof html !== 'string' || !html.includes('data-ngl-source-archive="v1"') ||
          !html.includes('SERVER-RECHECKED GITHUB BYTES · CLAIMS UNVERIFIED') ||
          !/^[a-f0-9]{64}$/.test(receiptDigest || '') ||
          metadata?.retrievalMode !== 'SERVER_RECHECKED' ||
          metadata?.repository !== expected.repository ||
          metadata?.commitSha !== expected.commitSha ||
          metadata?.path !== expected.path ||
          metadata?.permalink !== expected.permalink ||
          metadata?.gitBlobSha !== expected.gitBlobSha ||
          metadata?.sha256 !== expected.sha256 ||
          metadata?.size !== expected.size ||
          metadata?.bytesBase64 !== expected.bytesBase64) {
        throw new Error('The retained artifact does not match the exact server-rechecked mock GitHub fixture.');
      }
      const events = world.events;
      const publications = events.filter(event =>
        event?.type === 'publish' && event.creationId === expected.archiveId && event.version === 1
      );
      if (publications.length !== 1 || publications[0].actor?.role !== 'founder') {
        throw new Error('Expected one Founder-attributed publication for the exact Source Archive version.');
      }
      const proposals = events.filter(event =>
        event?.type === 'moonshot-proposed' &&
        event.actor?.id === expected.actorId &&
        event.actor?.role === expected.actorRole &&
        event.title === expected.proposalTitle &&
        event.sourceCreationId === expected.archiveId &&
        event.sourceVersion === 1
      );
      if (proposals.length !== 1) throw new Error('Expected one actor-attributed proposal linked to the exact Source Archive version.');
      const proposal = proposals[0];
      const publicationIndex = events.indexOf(publications[0]);
      const proposalIndex = events.indexOf(proposal);
      if (publicationIndex < 0 || proposalIndex <= publicationIndex) {
        throw new Error('The proposal must follow the exact retained Source Archive publication.');
      }
      const reports = events.filter(event =>
        event?.type === 'experiment-reported' &&
        event.actor?.id === expected.actorId &&
        event.actor?.role === expected.actorRole &&
        event.moonshotId === proposal.moonshotId
      );
      if (expected.requireReport ? reports.length !== 1 : reports.length !== 0) {
        throw new Error('Unexpected actor-attributed experiment-report count: ' + reports.length);
      }
      let report = null;
      let reportIndex = null;
      if (reports.length === 1) {
        report = reports[0];
        reportIndex = events.indexOf(report);
        const duplicateReportIds = events.filter(event =>
          event?.type === 'experiment-reported' && event.reportId === report.reportId
        ).length;
        if (reportIndex <= proposalIndex ||
            duplicateReportIds !== 1 ||
            report.evidenceCreationId !== expected.archiveId ||
            report.evidenceVersion !== 1 ||
            report.reportedOutcome !== 'failed') {
          throw new Error('The failed experiment attempt must follow and reference the same unique Source Archive version.');
        }
      }
      return {
        archiveCreationId: creation.id,
        archiveVersion: version.version,
        archiveReceiptDigestShapeValid: true,
        sourceRetrieval: 'SERVER_RECHECKED_MOCK_FIXTURE',
        sourceTransport: 'MOCK_GITHUB_CONTENTS_API',
        independentVerification: 'NOT_PERFORMED',
        publicationEventId: publications[0].id,
        publicationIndex,
        proposalEventId: proposal.id,
        proposalId: proposal.moonshotId,
        proposalIndex,
        proposalActorId: proposal.actor.id,
        proposalActorRole: proposal.actor.role,
        proposalSourceCreationId: proposal.sourceCreationId,
        proposalSourceVersion: proposal.sourceVersion,
        reportEventId: report?.id ?? null,
        reportId: report?.reportId ?? null,
        reportIndex,
        reportOutcome: report?.reportedOutcome ?? null,
        reportEvidenceCreationId: report?.evidenceCreationId ?? null,
        reportEvidenceVersion: report?.evidenceVersion ?? null,
        reportIdUnique: report !== null
      };
    }""", {
        'actorId': actor_id,
        'actorRole': actor_role,
        'archiveId': archive['creationId'],
        'proposalTitle': proposal_title,
        'requireReport': require_report,
        'repository': archive['repository'],
        'commitSha': archive['commitSha'],
        'path': archive['path'],
        'permalink': archive['permalink'],
        'gitBlobSha': archive['gitBlobSha'],
        'sha256': archive['sha256'],
        'size': archive['size'],
        'bytesBase64': archive['bytesBase64']
    })



def retained_event_id(page, event_type, field, value, actor_id=None):
    return page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not resolve retained event identity: ' + response.status);
      const dto = await response.json();
      const matches = dto.world.events.filter(event =>
        event.type === expected.eventType &&
        event[expected.field] === expected.value &&
        (!expected.actorId || event.actor?.id === expected.actorId)
      );
      if (matches.length !== 1) {
        throw new Error('Expected one retained ' + expected.eventType + ' event, found ' + matches.length);
      }
      return matches[0].id;
    }""", {
        'eventType': event_type,
        'field': field,
        'value': value,
        'actorId': actor_id
    })


def wait_for_retained_event_id(page, event_type, field, value, actor_id=None, actor_role=None, timeout=15000):
    # Poll and return the event ID from the same authoritative response that observes it.
    # A later post-reload summary independently verifies that the event persists.
    event_id = page.evaluate(
        """async expected => {
          const deadline = Date.now() + expected.timeoutMs;
          let last = { revision: null, eventCount: 0, matching: [], error: null };
          while (Date.now() < deadline) {
            try {
              const response = await fetch('/api/state', {
                cache: 'no-store',
                credentials: 'same-origin',
                signal: AbortSignal.timeout(2000)
              });
              if (!response.ok) {
                last.error = 'HTTP ' + response.status;
                if (response.status < 500) throw new Error('Could not resolve retained event identity: ' + response.status);
              } else {
                const dto = await response.json();
                if (!dto?.world || !Array.isArray(dto.world.events)) {
                  throw new Error('The shared world returned an incomplete event snapshot.');
                }
                const matches = dto.world.events.filter(event =>
                  event.type === expected.eventType &&
                  event[expected.field] === expected.value &&
                  (!expected.actorId || event.actor?.id === expected.actorId) &&
                  (!expected.actorRole || event.actor?.role === expected.actorRole)
                );
                if (matches.length > 1) {
                  throw new Error('Expected one retained ' + expected.eventType + ' event, found ' + matches.length);
                }
                if (matches.length === 1 && typeof matches[0].id === 'string' && matches[0].id) {
                  return matches[0].id;
                }
                last = {
                  revision: dto.world.revision,
                  eventCount: dto.world.events.length,
                  matching: matches.map(event => ({
                    id: event.id, type: event.type, actor: event.actor,
                    sourceEventId: event.sourceEventId
                  })),
                  error: null
                };
              }
            } catch (error) {
              last.error = String(error);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          throw new Error('Timed out waiting for retained event ' + expected.eventType +
            ' / ' + expected.value + ' / ' + expected.actorId + ' / ' + expected.actorRole +
            '; last snapshot=' + JSON.stringify(last));
        }""",
        {
            'eventType': event_type,
            'field': field,
            'value': value,
            'actorId': actor_id,
            'actorRole': actor_role,
            'timeoutMs': timeout
        }
    )
    if not isinstance(event_id, str) or not event_id:
        raise AssertionError('The retained event poll did not return an exact event ID.')
    return event_id


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


def assert_contradiction_ward_dossier(page, expected_text, expected_claim, expected_response,
                                      source_author_id, challenger_id, source_observation_event_id,
                                      challenge_event_id, response_event_id, screenshot):
    before = authoritative_snapshot(page)
    character_button = page.locator('#character-button')
    expect(character_button).to_be_visible()
    character_button.tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
        "!document.querySelector('#sheet').hidden"
    )
    ward = page.locator('#sheet-content [data-field-item-id]').filter(has_text='Contradiction Ward')
    expect(ward).to_have_count(1)
    dossier = ward.locator('[data-field-item-dissent]')
    expect(dossier).to_have_count(1)
    expect(dossier).to_contain_text('DISSENT PRESERVED · NOT ADJUDICATED')
    expect(dossier).to_contain_text('Challenge type: missing-evidence')
    expect(dossier).to_contain_text(expected_text)
    expect(dossier).to_contain_text('Against source note: ' + expected_claim)
    expect(dossier).to_contain_text('Source observation event: ' + source_observation_event_id)
    expect(dossier).to_contain_text('Challenge event: ' + challenge_event_id)
    expect(dossier).to_contain_text('Author response event: ' + response_event_id)
    expect(dossier).to_contain_text('Source note class (author-selected): model-assertion')
    expect(dossier).to_contain_text('Source description (author-entered): Synthetic browser fixture; no primary source was retrieved.')
    expect(dossier).to_contain_text('Possible falsifier: A direct primary-source check contradicts this note.')
    expect(dossier).to_contain_text('Uncertainty: The primary source has not been retrieved.')
    expect(dossier).to_contain_text('Next test: Retrieve and inspect the primary source.')
    expect(dossier).to_contain_text('Source note author: ' + source_author_id + ' (founder)')
    expect(dossier).to_contain_text('challenger: ' + challenger_id + ' (witness)')
    expect(dossier).to_contain_text('Original author response: ' + expected_response)
    expect(dossier).to_contain_text('Source retrieval: NOT_PERFORMED')
    expect(dossier).to_contain_text('Independent verification: NOT_PERFORMED')
    expect(dossier).to_contain_text('Model assertions: LEADS_ONLY')
    expect(dossier).to_contain_text('Execution: NOT_EXECUTED')
    expect(dossier).to_contain_text('not evidence, a truth verdict, XP, approval or authority')
    assert dossier.locator('img').count() == 0, 'Challenge text must render as text, never as executable markup.'
    after = authoritative_snapshot(page)
    assert after == before, 'Inspecting the Ward dossier must not mutate world state or XP.'
    screenshot = Path(screenshot)
    page.screenshot(path=str(screenshot), full_page=True)
    page.locator('#sheet-close').tap()
    return {
        'visible': True,
        'sourceAuthorId': source_author_id,
        'challengerId': challenger_id,
        'sourceObservationEventId': source_observation_event_id,
        'challengeEventId': challenge_event_id,
        'responseEventId': response_event_id,
        'challengeTextPreservedAsText': True,
        'authorResponsePreserved': True,
        'notEvidenceOrAdjudication': True,
        'readOnly': after == before,
        'screenshot': screenshot.name
    }


def assert_deliberator_character_record(page, role, expected_rounds, screenshot, require_320px=False,
                                        expected_armor_bearer=0):
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
    armor_bearer = page.locator('#sheet-content [data-skill-id="armor-bearer"]')
    expect(armor_bearer).to_have_count(1)
    expect(armor_bearer.locator('h3')).to_have_text('Armor Bearer')
    expect(armor_bearer).to_contain_text(f'{expected_armor_bearer} recorded')
    expect(armor_bearer).to_contain_text('accepted field-item transfer')
    expect(armor_bearer).to_contain_text('session IDs are pseudonymous')
    expect(armor_bearer).to_contain_text('no XP, mastery or NGL authority')
    viewport_width = page.evaluate("() => window.innerWidth")
    if require_320px:
        assert viewport_width == 320, 'The silent-member Character Record must run at 320 CSS pixels.'
        assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"), (
            'The 320px Character Record must not create horizontal page overflow.'
        )

    after = authoritative_snapshot(page)
    assert shared_world_snapshot(after) == shared_world_snapshot(before), (
        'Opening the Character Record must be read-only; it cannot append events or change XP.'
    )
    page.screenshot(path=str(screenshot), full_page=True)
    page.locator('#sheet-close').tap()
    return {
        'role': role,
        'deliberatorRounds': expected_rounds,
        'armorBearerTransfers': expected_armor_bearer,
        'readOnly': True,
        'xpUnchanged': after['xp'] == before['xp'],
        'viewportWidth': viewport_width,
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

    silent_context = browser.new_context(
        viewport={'width': 320, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    silent_page = silent_context.new_page()
    silent_errors = []
    silent_page.on('pageerror', lambda error: silent_errors.append(str(error)))
    try:
        witness_page.goto(url, wait_until='networkidle')
        witness_page.locator('#start-shared').tap()
        witness_page.locator('#world').wait_for(state='visible')
        witness_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        silent_page.goto(url, wait_until='networkidle')
        silent_page.locator('#start-shared').tap()
        silent_page.locator('#world').wait_for(state='visible')
        silent_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )

        founder_before = authoritative_snapshot(founder_page)
        witness_before = authoritative_snapshot(witness_page)
        silent_before = authoritative_snapshot(silent_page)
        assert founder_before['viewerRole'] == 'founder'
        assert witness_before['viewerRole'] == 'witness'
        assert silent_before['viewerRole'] == 'witness'
        assert len({
            founder_before['viewerId'], witness_before['viewerId'], silent_before['viewerId']
        }) == 3, 'The circuit requires three independent session identities.'

        guild_payload = post_action(founder_page, {
            'type': 'create-guild',
            'name': 'Quest Board Dissent Circuit',
            'charter': 'Preserve dissent; never promote model assertions to evidence.',
            'requestId': 'quest-board-guild-create'
        })
        guild_id = guild_payload.get('result', {}).get('guildId')
        assert isinstance(guild_id, str) and guild_id

        join_payload = post_action(witness_page, {
            'type': 'join-guild',
            'guildId': guild_id,
            'requestId': 'quest-board-guild-join'
        })
        assert join_payload.get('result', {}).get('guildId') == guild_id
        silent_join_payload = post_action(silent_page, {
            'type': 'join-guild',
            'guildId': guild_id,
            'requestId': 'quest-board-guild-silent-member-join'
        })
        assert silent_join_payload.get('result', {}).get('guildId') == guild_id

        founder_note = record_source_observation(
            founder_page, observatory_fixture, 'Founder fixture claim: the model assertion is not verified.'
        )
        witness_note = record_source_observation(
            witness_page, observatory_fixture, 'Witness fixture claim: retrieval remains unperformed.'
        )
        challenge_payload = post_action(witness_page, {
            'type': 'challenge-source-observation',
            'observationId': founder_note['observationId'],
            'challengeType': 'missing-evidence',
            'challengeText': 'The model assertion has no retrieved primary source. Literal <img> text remains text.',
            'requestId': 'quest-board-guild-challenge'
        })
        challenge_id = challenge_payload.get('result', {}).get('challengeId')
        assert isinstance(challenge_id, str) and challenge_id
        challenge_event_id = retained_event_id(
            witness_page, 'source-observation-challenged', 'challengeId', challenge_id,
            witness_before['viewerId']
        )
        queue_founder_390 = assert_source_observation_queue_mobile(
            founder_page, challenge_id, challenge_event_id, observatory_fixture['creationId'],
            'Founder fixture claim: the model assertion is not verified.',
            'The model assertion has no retrieved primary source. Literal <img> text remains text.',
            out / 'source-observation-queue-founder-390.png'
        )
        queue_silent_320 = assert_source_observation_queue_mobile(
            silent_page, challenge_id, challenge_event_id, observatory_fixture['creationId'],
            'Founder fixture claim: the model assertion is not verified.',
            'The model assertion has no retrieved primary source. Literal <img> text remains text.',
            out / 'source-observation-queue-silent-320.png'
        )

        response_payload = post_action(founder_page, {
            'type': 'respond-source-observation-challenge',
            'challengeId': challenge_id,
            'responseText': 'Agreed: this remains a lead until the primary source is retrieved.',
            'requestId': 'quest-board-guild-response'
        })
        response_id = response_payload.get('result', {}).get('responseId')
        assert isinstance(response_id, str)
        source_observation_event_id = retained_event_id(
            founder_page, 'source-observation-recorded', 'observationId',
            founder_note['observationId'], founder_before['viewerId']
        )
        response_event_id = retained_event_id(
            founder_page, 'source-observation-challenge-responded', 'responseId',
            response_id, founder_before['viewerId']
        )

        # The challenger turns their own retained Source Observatory dissent into a
        # Forge object, then equips it. The source note's author cannot inherit this progress.
        post_action(witness_page, {
            'type': 'forge-field-item',
            'slotId': 'adversarial',
            'sourceEventId': challenge_event_id,
            'requestId': 'quest-board-contradiction-ward-forge'
        })
        forge_event_id = retained_event_id(
            witness_page, 'field-item-forged', 'sourceEventId', challenge_event_id,
            witness_before['viewerId']
        )
        post_action(witness_page, {
            'type': 'equip-field-item',
            'slotId': 'adversarial',
            'sourceEventId': forge_event_id,
            'requestId': 'quest-board-contradiction-ward-equip'
        })
        equip_event_id = retained_event_id(
            witness_page, 'field-item-equipped', 'sourceEventId', forge_event_id,
            witness_before['viewerId']
        )
        assert challenge_event_id and forge_event_id and equip_event_id
        ward_dossier = assert_contradiction_ward_dossier(
            witness_page,
            'The model assertion has no retrieved primary source. Literal <img> text remains text.',
            'Founder fixture claim: the model assertion is not verified.',
            'Agreed: this remains a lead until the primary source is retrieved.',
            founder_before['viewerId'],
            witness_before['viewerId'],
            source_observation_event_id,
            challenge_event_id,
            response_event_id,
            out / 'contradiction-ward-dossier-witness-390.png'
        )

        # The Ward can travel between players only through a retained offer and
        # designated-recipient acceptance. Its immutable dissent dossier follows.
        witness_page.locator('#character-button').tap()
        witness_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        witness_page.locator(
            '#sheet-content [data-equipment-slot="adversarial"] [data-unequip-field-item="adversarial"]'
        ).tap()
        ward_card = witness_page.locator('#sheet-content [data-field-item-id]').filter(has_text='Contradiction Ward')
        recipient_selector = ward_card.locator('[data-transfer-recipient]')
        expect(recipient_selector).to_be_visible()
        witness_page.wait_for_function(
            "actorId => { const select = document.querySelector('#sheet-content [data-transfer-recipient]'); "
            "return Boolean(select && Array.from(select.options).some(option => "
            "option.value === actorId && option.getAttribute('data-role') === 'founder')); }",
            arg=founder_before['viewerId']
        )
        recipient_selector.select_option(value=founder_before['viewerId'])
        offer_button = ward_card.locator('[data-offer-field-item]')
        expect(offer_button).to_be_visible()
        offer_button.tap()
        expect(ward_card.locator('[data-cancel-field-item-transfer]')).to_be_visible()
        assert witness_page.locator('#sheet-content [data-accept-field-item-transfer]').count() == 0
        transfer_offer = witness_page.evaluate("""async expected => {
          const response = await fetch('/api/state', {cache: 'no-store', credentials: 'same-origin'});
          if (!response.ok) throw new Error('Could not inspect the retained Ward transfer offer.');
          const dto = await response.json();
          const matches = dto.world.events.filter(event =>
            event.type === 'field-item-transfer-offered' &&
            event.itemEventId === expected.itemEventId &&
            event.actor?.id === expected.actorId
          );
          if (matches.length !== 1) throw new Error('Expected one retained Ward offer, found ' + matches.length);
          const event = matches[0];
          return {eventId: event.id, offerId: event.offerId,
            recipientId: event.recipientId, recipientRole: event.recipientRole};
        }""", {
            'itemEventId': forge_event_id,
            'actorId': witness_before['viewerId']
        })
        assert transfer_offer['recipientId'] == founder_before['viewerId']
        assert transfer_offer['recipientRole'] == 'founder'
        assert transfer_offer['offerId']

        founder_page.reload(wait_until='networkidle')
        founder_page.locator('#start-shared').tap()
        founder_page.locator('#world').wait_for(state='visible')
        founder_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
        founder_page.locator('#character-button').tap()
        founder_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        incoming_offer = founder_page.locator('#sheet-content [data-field-transfer-offer]').filter(
            has_text='Contradiction Ward'
        )
        expect(incoming_offer).to_have_count(1)
        accept_button = incoming_offer.locator('[data-accept-field-item-transfer]')
        expect(accept_button).to_have_count(1)
        assert accept_button.get_attribute('data-accept-field-item-transfer') == transfer_offer['offerId']
        pending_history_before = authoritative_snapshot(founder_page)
        pending_history = incoming_offer.locator('[data-field-item-transfer-history]')
        expect(pending_history).to_have_count(1)
        expect(pending_history).to_have_attribute('data-history-total', '1')
        pending_entry = pending_history.locator(
            '[data-field-item-transfer-history-entry="' + transfer_offer['offerId'] + '"]'
        )
        expect(pending_entry).to_have_count(1)
        expect(pending_entry).to_have_attribute('data-transfer-status', 'offered')
        expect(pending_history).to_contain_text('HANDOFF HISTORY')
        expect(pending_entry).to_contain_text('Pending')
        expect(pending_entry).to_contain_text(transfer_offer['eventId'])
        expect(pending_entry).to_contain_text(witness_before['viewerId'])
        expect(pending_entry).to_contain_text(founder_before['viewerId'])
        pending_history_after = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(pending_history_after) == shared_world_snapshot(pending_history_before), (
            'Inspecting a pending incoming item’s handoff history must be read-only.'
        )
        assert pending_history_after['xp'] == pending_history_before['xp']
        accept_button.tap()
        founder_ward = founder_page.locator('#sheet-content [data-field-item-id]').filter(
            has_text='Contradiction Ward'
        )
        expect(founder_ward).to_have_count(1)
        expect(founder_ward).to_contain_text('current owner ' + founder_before['viewerId'])
        expect(founder_ward).to_contain_text('Original creator ' + witness_before['viewerId'])

        transfer_event_id = wait_for_retained_event_id(
            founder_page, 'field-item-transferred', 'offerId',
            transfer_offer['offerId'], founder_before['viewerId'], 'founder', timeout=15000
        )
        assert transfer_event_id

        handoff_history_before = authoritative_snapshot(founder_page)
        handoff_history = founder_ward.locator('[data-field-item-transfer-history]')
        expect(handoff_history).to_have_count(1)
        expect(handoff_history).to_have_attribute('data-history-total', '1')
        handoff_entry = handoff_history.locator(
            '[data-field-item-transfer-history-entry="' + transfer_offer['offerId'] + '"]'
        )
        expect(handoff_entry).to_have_count(1)
        expect(handoff_entry).to_have_attribute('data-transfer-status', 'accepted')
        expect(handoff_history).to_contain_text('HANDOFF HISTORY')
        expect(handoff_entry).to_contain_text('Accepted')
        expect(handoff_entry).to_contain_text(transfer_offer['eventId'])
        expect(handoff_entry).to_contain_text(transfer_event_id)
        expect(handoff_entry).to_contain_text(witness_before['viewerId'])
        expect(handoff_entry).to_contain_text(founder_before['viewerId'])
        handoff_history_after = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(handoff_history_after) == shared_world_snapshot(handoff_history_before), (
            'Inspecting the current item’s retained handoff history must be read-only.'
        )
        assert handoff_history_after['xp'] == handoff_history_before['xp']

        post_action(witness_page, {
            'type': 'contribute',
            'creationId': observatory_fixture['creationId'],
            'version': observatory_fixture['version'],
            'text': 'A second field-item source for an independent handoff objective; not a verified claim.',
            'requestId': 'quest-board-witness-second-field-contribution'
        })
        contribution_event_id = retained_event_id(
            witness_page, 'contribute', 'creationId',
            observatory_fixture['creationId'], witness_before['viewerId']
        )
        post_action(witness_page, {
            'type': 'forge-field-item',
            'slotId': 'observation',
            'sourceEventId': contribution_event_id,
            'requestId': 'quest-board-witness-second-field-forge'
        })
        second_forge_event_id = retained_event_id(
            witness_page, 'field-item-forged', 'sourceEventId',
            contribution_event_id, witness_before['viewerId']
        )
        assert contribution_event_id and second_forge_event_id

        decline_offer_payload = post_action(witness_page, {
            'type': 'offer-field-item-transfer',
            'itemEventId': second_forge_event_id,
            'recipientId': founder_before['viewerId'],
            'recipientRole': 'founder',
            'requestId': 'quest-board-witness-second-field-decline-offer'
        })
        decline_offer_id = decline_offer_payload.get('result', {}).get('offerId')
        assert isinstance(decline_offer_id, str) and decline_offer_id

        founder_page.reload(wait_until='networkidle')
        founder_page.locator('#start-shared').tap()
        founder_page.locator('#world').wait_for(state='visible')
        founder_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
        founder_page.locator('#character-button').tap()
        founder_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        incoming_decline_card = founder_page.locator(
            '#sheet-content [data-field-transfer-offer="' + decline_offer_id + '"]'
        )
        expect(incoming_decline_card).to_have_count(1)
        decline_button = incoming_decline_card.get_by_role(
            'button', name='Decline transfer', exact=True
        )
        expect(decline_button).to_be_visible()
        decline_before = authoritative_snapshot(founder_page)
        decline_button.tap()
        decline_event_id = wait_for_retained_event_id(
            founder_page, 'field-item-transfer-declined', 'offerId',
            decline_offer_id, founder_before['viewerId'], 'founder', timeout=15000
        )
        assert decline_event_id
        expect(founder_page.locator(
            '#sheet-content [data-field-transfer-offer="' + decline_offer_id + '"]'
        )).to_have_count(0)
        decline_after = authoritative_snapshot(founder_page)
        assert decline_after['xp'] == decline_before['xp'], (
            'Declining a field-item offer must not award XP.'
        )
        assert decline_after['revision'] == decline_before['revision'] + 1

        recipient_history = founder_page.locator(
            '#sheet-content [data-field-item-participant-history]'
        )
        expect(recipient_history).to_have_count(1)
        expect(recipient_history).to_have_attribute('data-history-total', '2')
        expect(recipient_history).to_contain_text('MY HANDOFF HISTORY')
        declined_participant_row = recipient_history.locator(
            '[data-field-item-participant-history-entry="' + decline_offer_id + '"]'
        )
        expect(declined_participant_row).to_have_count(1)
        expect(declined_participant_row).to_have_attribute('data-transfer-status', 'declined')
        expect(declined_participant_row).to_contain_text('You declined')
        expect(declined_participant_row).to_contain_text(decline_event_id)
        event_chain = declined_participant_row.locator(
            '[data-field-item-history-event-chain]'
        )
        expect(event_chain).to_have_count(1)
        event_chain.locator('summary').tap()
        offer_event_id = founder_page.evaluate("""async offerId => {
          const response = await fetch('/api/state', {
            cache: 'no-store', credentials: 'same-origin'
          });
          if (!response.ok) throw new Error('Could not inspect the retained offer event.');
          const dto = await response.json();
          const matches = dto.world.events.filter(event =>
            event.type === 'field-item-transfer-offered' && event.offerId === offerId
          );
          return matches.length === 1 ? matches[0].id : null;
        }""", decline_offer_id)
        assert offer_event_id
        expected_chain_events = [
            ('source', contribution_event_id),
            ('forge', second_forge_event_id),
            ('offer', offer_event_id),
            ('declined', decline_event_id)
        ]
        expect(event_chain.locator('[data-field-item-history-event-link]')).to_have_count(4)
        actual_chain_kinds = event_chain.locator(
            '[data-field-item-history-event-link]'
        ).evaluate_all("nodes => nodes.map(node => node.getAttribute('data-field-item-history-event-link'))")
        assert actual_chain_kinds == [kind for kind, _ in expected_chain_events], (
            'The retained handoff chain must be presented in source-to-outcome order.'
        )
        chain_navigation_results = []
        chain_navigation_xp_deltas = []
        declined_chronicle_card = None
        for event_index, (event_kind, event_id) in enumerate(expected_chain_events):
            event_link = event_chain.locator(
                '[data-field-item-history-event-link="' + event_kind + '"]'
            )
            expect(event_link).to_have_count(1)
            expect(event_link).to_have_attribute('data-chronicle-event-id', event_id)
            expected_event_labels = {
                'source': 'Inspect source activity in World Chronicle',
                'forge': 'Inspect Forge event in World Chronicle',
                'offer': 'Inspect offer event in World Chronicle',
                'declined': 'Inspect recipient refusal in World Chronicle'
            }
            expect(event_link).to_have_attribute('aria-label', expected_event_labels[event_kind])
            chronicle_before = authoritative_snapshot(founder_page)
            event_link.tap()
            expect(founder_page.locator('#sheet-title')).to_have_text('World Chronicle')
            exact_handoff_card = founder_page.locator(
                '#sheet-content [data-event-id="world:' + event_id + '"]'
            )
            expect(exact_handoff_card).to_have_count(1)
            expect(exact_handoff_card).to_have_attribute('data-event-source', 'world')
            chronicle_status = founder_page.locator(
                '#sheet-content [data-chronicle-page-status]'
            )
            expect(chronicle_status).to_contain_text('exact source event ID')
            if event_kind == 'declined':
                expect(exact_handoff_card.locator('h3')).to_have_text('Field-item transfer declined')
                expect(exact_handoff_card).to_contain_text('FORGE · TRANSFER')
                expect(exact_handoff_card).to_contain_text('FIELD-ITEM-TRANSFER-DECLINED')
                expect(exact_handoff_card).to_contain_text('The designated recipient declined the offer')
                expect(exact_handoff_card).to_contain_text('The refusal did not transfer ownership')
                expect(exact_handoff_card).to_contain_text('item remained with its owner at the time')
                expect(exact_handoff_card).to_contain_text('retained as consent history')
                expect(exact_handoff_card).to_contain_text('No XP, combat statistics or authority')
                expect(exact_handoff_card).to_contain_text('Offer: ' + decline_offer_id)
                expect(exact_handoff_card).to_contain_text(
                    'Designated recipient: ' + founder_before['viewerId'] + ' (founder)'
                )
                expect(exact_handoff_card).to_contain_text(
                    'Original forge event: ' + second_forge_event_id
                )
                expect(exact_handoff_card.locator('.evidence-warning')).to_have_count(0)
            chronicle_after = authoritative_snapshot(founder_page)
            assert shared_world_snapshot(chronicle_after) == shared_world_snapshot(chronicle_before), (
                'Opening each retained handoff-chain event in Chronicle must not mutate the shared world.'
            )
            assert chronicle_after['xp'] == chronicle_before['xp']
            if event_kind == 'declined':
                declined_chronicle_card = {
                    'eventId': decline_event_id,
                    'offerId': decline_offer_id,
                    'recipientId': founder_before['viewerId'],
                    'forgeEventId': second_forge_event_id,
                    'title': 'Field-item transfer declined',
                    'sourceStream': 'world',
                    'timeBoundedOwnership': True,
                    'offerRecipientAndForgeLinked': True,
                    'unvalidatedWarningShown': False,
                    'readOnly': shared_world_snapshot(chronicle_after) == shared_world_snapshot(chronicle_before),
                    'xpDelta': chronicle_after['xp'] - chronicle_before['xp']
                }
            chain_navigation_results.append(event_kind)
            chain_navigation_xp_deltas.append(chronicle_after['xp'] - chronicle_before['xp'])
            founder_page.locator('#sheet-close').tap()
            founder_page.locator('#character-button').tap()
            founder_page.wait_for_function(
                "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
                "!document.querySelector('#sheet').hidden"
            )
            recipient_history = founder_page.locator(
                '#sheet-content [data-field-item-participant-history]'
            )
            declined_participant_row = recipient_history.locator(
                '[data-field-item-participant-history-entry="' + decline_offer_id + '"]'
            )
            event_chain = declined_participant_row.locator(
                '[data-field-item-history-event-chain]'
            )
            if event_index + 1 < len(expected_chain_events):
                event_chain.locator('summary').tap()
        accepted_participant_row = recipient_history.locator(
            '[data-field-item-participant-history-entry="' + transfer_offer['offerId'] + '"]'
        )
        expect(accepted_participant_row).to_have_count(1)
        expect(accepted_participant_row).to_have_attribute('data-transfer-status', 'accepted')
        expect(accepted_participant_row).to_contain_text('You accepted')
        expect(accepted_participant_row).to_contain_text(transfer_event_id)
        accepted_event_chain = accepted_participant_row.locator(
            '[data-field-item-history-event-chain]'
        )
        expect(accepted_event_chain).to_have_count(1)
        accepted_event_chain.locator('summary').tap()
        expect(accepted_event_chain.locator('[data-field-item-history-event-link]')).to_have_count(4)
        accepted_chain_kinds = accepted_event_chain.locator(
            '[data-field-item-history-event-link]'
        ).evaluate_all("nodes => nodes.map(node => node.getAttribute('data-field-item-history-event-link'))")
        assert accepted_chain_kinds == ['source', 'forge', 'offer', 'accepted']
        accepted_link = accepted_event_chain.locator(
            '[data-field-item-history-event-link="accepted"]'
        )
        expect(accepted_link).to_have_count(1)
        expect(accepted_link).to_have_attribute('data-chronicle-event-id', transfer_event_id)
        expect(accepted_link).to_have_attribute(
            'aria-label', 'Inspect recipient acceptance in World Chronicle'
        )
        accepted_chain_before = authoritative_snapshot(founder_page)
        accepted_link.tap()
        expect(founder_page.locator('#sheet-title')).to_have_text('World Chronicle')
        exact_acceptance_card = founder_page.locator(
            '#sheet-content [data-event-id="world:' + transfer_event_id + '"]'
        )
        expect(exact_acceptance_card).to_have_count(1)
        expect(exact_acceptance_card).to_have_attribute('data-event-source', 'world')
        accepted_chain_after = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(accepted_chain_after) == shared_world_snapshot(accepted_chain_before), (
            'Opening the accepted handoff outcome in Chronicle must remain read-only.'
        )
        assert accepted_chain_after['xp'] == accepted_chain_before['xp']
        accepted_chain_xp_delta = accepted_chain_after['xp'] - accepted_chain_before['xp']
        founder_page.locator('#sheet-close').tap()
        founder_page.locator('#character-button').tap()
        founder_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        recipient_history = founder_page.locator(
            '#sheet-content [data-field-item-participant-history]'
        )
        participant_history_after = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(participant_history_after) == shared_world_snapshot(decline_after), (
            'Inspecting participant handoff history must remain read-only.'
        )
        assert participant_history_after['xp'] == decline_after['xp']

        # Leave the Founder sheet open for the already-existing recipient-equip
        # step later in this shared-world journey.

        witness_page.reload(wait_until='networkidle')
        witness_page.locator('#start-shared').tap()
        witness_page.locator('#world').wait_for(state='visible')
        witness_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        witness_page.locator('#character-button').tap()
        witness_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        second_forge_item_id = witness_page.evaluate("""async eventId => {
          const response = await fetch('/api/state', {
            cache: 'no-store', credentials: 'same-origin'
          });
          if (!response.ok) throw new Error('Shared state read failed: ' + response.status);
          const dto = await response.json();
          const event = dto.world.events.find(candidate => candidate.id === eventId);
          return event?.itemId || null;
        }""", second_forge_event_id)
        assert isinstance(second_forge_item_id, str) and second_forge_item_id
        declined_item = witness_page.locator(
            '#sheet-content [data-field-item-id="' + second_forge_item_id + '"]'
        )
        expect(declined_item).to_have_count(1)
        expect(declined_item).to_contain_text('current owner ' + witness_before['viewerId'])
        declined_history = declined_item.locator(
            '[data-field-item-transfer-history-entry="' + decline_offer_id + '"]'
        )
        expect(declined_history).to_have_count(1)
        expect(declined_history).to_have_attribute('data-transfer-status', 'declined')
        expect(declined_history).to_contain_text('Declined')
        expect(declined_history).to_contain_text(decline_event_id)
        decline_history_before = authoritative_snapshot(witness_page)
        decline_history_after = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(decline_history_after) == shared_world_snapshot(decline_history_before), (
            'Inspecting a declined handoff remains read-only.'
        )
        assert decline_history_after['xp'] == decline_history_before['xp']

        item_history_chain = declined_history.locator(
            '[data-field-item-transfer-history-event-chain]'
        )
        expect(item_history_chain).to_have_count(1)
        item_history_chain.locator('summary').tap()
        item_history_links = item_history_chain.locator(
            '[data-field-item-transfer-history-event-link]'
        )
        expect(item_history_links).to_have_count(4)
        item_history_kinds = item_history_links.evaluate_all(
            "nodes => nodes.map(node => node.getAttribute('data-field-item-transfer-history-event-link'))"
        )
        assert item_history_kinds == ['source', 'forge', 'offer', 'declined'], (
            'The item-level handoff ledger must expose its exact source-to-refusal event chain.'
        )
        expected_item_history_events = [
            ('source', contribution_event_id, 'Inspect source activity in World Chronicle'),
            ('forge', second_forge_event_id, 'Inspect Forge event in World Chronicle'),
            ('offer', offer_event_id, 'Inspect offer event in World Chronicle'),
            ('declined', decline_event_id, 'Inspect recipient refusal in World Chronicle')
        ]
        for kind, event_id, label in expected_item_history_events:
            event_link = item_history_chain.locator(
                '[data-field-item-transfer-history-event-link="' + kind + '"]'
            )
            expect(event_link).to_have_count(1)
            expect(event_link).to_have_attribute('data-chronicle-event-id', event_id)
            expect(event_link).to_have_attribute(
                'data-field-item-transfer-history-offer', decline_offer_id
            )
            expect(event_link).to_have_attribute('data-chronicle-source', 'world')
            expect(event_link).to_have_attribute('aria-label', label)

        item_decline_link = item_history_chain.locator(
            '[data-field-item-transfer-history-event-link="declined"]'
        )
        item_history_before_navigation = authoritative_snapshot(witness_page)
        item_decline_link.tap()
        expect(witness_page.locator('#sheet-title')).to_have_text('World Chronicle')
        item_history_decline_card = witness_page.locator(
            '#sheet-content [data-event-id="world:' + decline_event_id + '"]'
        )
        expect(item_history_decline_card).to_have_count(1)
        expect(item_history_decline_card).to_have_attribute('data-event-source', 'world')
        expect(item_history_decline_card.locator('h3')).to_have_text('Field-item transfer declined')
        item_history_after_navigation = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(item_history_after_navigation) == shared_world_snapshot(item_history_before_navigation), (
            'Navigating from an item-level refusal to Chronicle must remain read-only.'
        )
        assert item_history_after_navigation['xp'] == item_history_before_navigation['xp']
        item_history_chronicle_navigation = {
            'eventKinds': item_history_kinds,
            'declineEventId': decline_event_id,
            'exactWorldEventOpened': True,
            'readOnly': shared_world_snapshot(item_history_after_navigation) == shared_world_snapshot(item_history_before_navigation),
            'xpDelta': item_history_after_navigation['xp'] - item_history_before_navigation['xp']
        }
        witness_page.locator('#sheet-close').tap()

        # Re-open the same retained item chain at the narrowest supported mobile
        # viewport. Keep the same session actor so this is a responsive-layout
        # check, not a second identity or a new world mutation.
        witness_page.set_viewport_size({'width': 320, 'height': 844})
        witness_page.locator('#character-button').tap()
        witness_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        declined_item_320 = witness_page.locator(
            '#sheet-content [data-field-item-id="' + second_forge_item_id + '"]'
        )
        expect(declined_item_320).to_have_count(1)
        declined_history_320 = declined_item_320.locator(
            '[data-field-item-transfer-history-entry="' + decline_offer_id + '"]'
        )
        expect(declined_history_320).to_have_count(1)
        item_history_chain_320 = declined_history_320.locator(
            '[data-field-item-transfer-history-event-chain]'
        )
        expect(item_history_chain_320).to_have_count(1)
        item_history_chain_320.locator('summary').tap()
        item_history_links_320 = item_history_chain_320.locator(
            '[data-field-item-transfer-history-event-link]'
        )
        expect(item_history_links_320).to_have_count(4)
        item_history_kinds_320 = item_history_links_320.evaluate_all(
            "nodes => nodes.map(node => node.getAttribute('data-field-item-transfer-history-event-link'))"
        )
        assert item_history_kinds_320 == ['source', 'forge', 'offer', 'declined'], (
            'The 320px item-level handoff ledger must preserve its source-to-refusal event chain.'
        )
        expected_item_history_events_320 = [
            ('source', contribution_event_id, 'Inspect source activity in World Chronicle'),
            ('forge', second_forge_event_id, 'Inspect Forge event in World Chronicle'),
            ('offer', offer_event_id, 'Inspect offer event in World Chronicle'),
            ('declined', decline_event_id, 'Inspect recipient refusal in World Chronicle')
        ]
        for kind, event_id, label in expected_item_history_events_320:
            event_link = item_history_chain_320.locator(
                '[data-field-item-transfer-history-event-link="' + kind + '"]'
            )
            expect(event_link).to_have_count(1)
            expect(event_link).to_have_attribute('data-chronicle-event-id', event_id)
            expect(event_link).to_have_attribute(
                'data-field-item-transfer-history-offer', decline_offer_id
            )
            expect(event_link).to_have_attribute('data-chronicle-source', 'world')
            expect(event_link).to_have_attribute('aria-label', label)

        viewport_width_320 = witness_page.evaluate("() => window.innerWidth")
        assert viewport_width_320 == 320
        no_horizontal_overflow_320 = witness_page.evaluate(
            "() => document.documentElement.scrollWidth <= window.innerWidth"
        )
        assert no_horizontal_overflow_320, (
            'The 320px Field Kit handoff history must not create horizontal page overflow.'
        )
        item_history_320_before = authoritative_snapshot(witness_page)
        item_decline_link_320 = item_history_chain_320.locator(
            '[data-field-item-transfer-history-event-link="declined"]'
        )
        item_decline_link_320.tap()
        expect(witness_page.locator('#sheet-title')).to_have_text('World Chronicle')
        item_history_decline_card_320 = witness_page.locator(
            '#sheet-content [data-event-id="world:' + decline_event_id + '"]'
        )
        expect(item_history_decline_card_320).to_have_count(1)
        expect(item_history_decline_card_320).to_have_attribute('data-event-source', 'world')
        expect(item_history_decline_card_320.locator('h3')).to_have_text('Field-item transfer declined')
        item_history_320_after = authoritative_snapshot(witness_page)
        item_history_320_read_only = (
            shared_world_snapshot(item_history_320_after) == shared_world_snapshot(item_history_320_before)
        )
        assert item_history_320_read_only, (
            'Opening the retained refusal from the 320px item-level history must remain read-only.'
        )
        assert item_history_320_after['xp'] == item_history_320_before['xp']
        item_history_chronicle_screenshot = out / 'field-kit-item-history-chronicle-320.png'
        witness_page.screenshot(path=str(item_history_chronicle_screenshot), full_page=True)
        item_history_chronicle_navigation_320 = {
            'viewportWidth': viewport_width_320,
            'noHorizontalOverflow': no_horizontal_overflow_320,
            'eventKinds': item_history_kinds_320,
            'declineEventId': decline_event_id,
            'exactWorldEventOpened': True,
            'readOnly': item_history_320_read_only,
            'xpDelta': item_history_320_after['xp'] - item_history_320_before['xp'],
            'screenshot': item_history_chronicle_screenshot.name
        }
        witness_page.locator('#sheet-close').tap()
        witness_page.set_viewport_size({'width': 390, 'height': 844})

        # Keep the Founder sheet open: the next existing step equips the
        # previously accepted Contradiction Ward through its current owner card.
        open_quest_board(witness_page)
        assert_board(witness_page, 'witness')
        assert_armor_bearer_delivery_objective(witness_page, 'witness', '1/4', complete=False)
        actionable_row = witness_page.locator(
            '#sheet-content [data-objective-id="witness-armor-bearer-delivery"]'
        )
        expect(actionable_row.get_by_role('button', name='Go do this →', exact=True)).to_be_visible()
        pending_row = assert_armor_bearer_chain_objective(
            witness_page, 'witness', transfer_event_id, '3/4', complete=False
        )
        expect(pending_row).to_contain_text('designated recipient must equip')
        board_read_before = authoritative_snapshot(witness_page)
        board_read_after = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(board_read_after) == shared_world_snapshot(board_read_before), (
            'The two-chain Quest Board inspection must remain read-only.'
        )
        assert board_read_after['xp'] == board_read_before['xp']
        witness_page.locator('#sheet-close').tap()

        received_ward_equip = founder_ward.locator('[data-equip-forged-item]')
        expect(received_ward_equip).to_be_visible()
        received_ward_equip.tap()
        recipient_equip_event_id = wait_for_retained_event_id(
            founder_page, 'field-item-equipped', 'sourceEventId',
            forge_event_id, founder_before['viewerId'], founder_before['viewerRole'], timeout=15000
        )
        assert recipient_equip_event_id
        founder_page.locator('#sheet-close').tap()

        founder_page.reload(wait_until='networkidle')
        founder_page.locator('#start-shared').tap()
        founder_page.locator('#world').wait_for(state='visible')
        founder_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
        founder_transfer_dossier = assert_contradiction_ward_dossier(
            founder_page,
            'The model assertion has no retrieved primary source. Literal <img> text remains text.',
            'Founder fixture claim: the model assertion is not verified.',
            'Agreed: this remains a lead until the primary source is retrieved.',
            founder_before['viewerId'],
            witness_before['viewerId'],
            source_observation_event_id,
            challenge_event_id,
            response_event_id,
            out / 'contradiction-ward-dossier-recipient-founder-390.png'
        )

        witness_page.reload(wait_until='networkidle')
        witness_page.locator('#start-shared').tap()
        witness_page.locator('#world').wait_for(state='visible')
        witness_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        witness_before_empty_inventory = authoritative_snapshot(witness_page)
        witness_page.locator('#character-button').tap()
        witness_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        expect(witness_page.locator(
            '#sheet-content [data-field-item-id]'
        ).filter(has_text='Contradiction Ward')).to_have_count(0)
        witness_after_empty_inventory = authoritative_snapshot(witness_page)
        assert witness_after_empty_inventory == witness_before_empty_inventory, (
            'Inspecting the sender’s post-transfer inventory must be read-only.'
        )
        witness_page.locator('#sheet-close').tap()

        after_founder = authoritative_snapshot(founder_page)
        after_witness = authoritative_snapshot(witness_page)
        after_silent = authoritative_snapshot(silent_page)
        assert shared_world_snapshot(after_founder) == shared_world_snapshot(after_witness)
        assert shared_world_snapshot(after_founder) == shared_world_snapshot(after_silent), (
            'All three independent contexts must observe the same retained shared world.'
        )
        assert after_founder['xp'] == founder_before['xp'] == after_silent['xp'], (
            'Guild membership, observations, dissent and response award no XP.'
        )
        assert after_founder['revision'] == founder_before['revision'] + 17, (
            'Exactly seventeen canonical actions should be retained: the original nine, four transfer/equipment actions, the second contribution plus Forge, and one recipient offer plus decline.'
        )
        assert after_witness['xp'] == witness_before['xp'] == after_silent['xp']
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
            guildJoinActors: events.filter(event => event.type === 'guild-joined').map(event => event.actor.id),
            observations: observations.map(event => ({
              actorId: event.actor.id,
              sourceRetrieval: event.sourceRetrieval,
              independentVerification: event.independentVerification,
              modelAssertions: event.modelAssertions
            })),
            contributions: events.filter(event => event.type === 'contribute').map(event => ({
              id: event.id, actorId: event.actor.id, creationId: event.creationId, version: event.version
            })),
            challengeActors: events.filter(event => event.type === 'source-observation-challenged').map(event => event.actor.id),
            responseActors: events.filter(event => event.type === 'source-observation-challenge-responded').map(event => event.actor.id),
            challenges: count('source-observation-challenged'),
            responses: count('source-observation-challenge-responded'),
            forges: events.filter(event => event.type === 'field-item-forged').map(event => ({
              id: event.id, actorId: event.actor.id, slotId: event.slotId, sourceEventId: event.sourceEventId
            })),
            equips: events.filter(event => event.type === 'field-item-equipped').map(event => ({
              id: event.id, actorId: event.actor.id, slotId: event.slotId, sourceEventId: event.sourceEventId
            })),
            unequips: events.filter(event => event.type === 'field-item-unequipped').map(event => ({
              id: event.id, actorId: event.actor.id, slotId: event.slotId
            })),
            transferOffers: events.filter(event => event.type === 'field-item-transfer-offered').map(event => ({
              id: event.id, actorId: event.actor.id, itemEventId: event.itemEventId,
              offerId: event.offerId, recipientId: event.recipientId, recipientRole: event.recipientRole
            })),
            transfers: events.filter(event => event.type === 'field-item-transferred').map(event => ({
              id: event.id, actorId: event.actor.id, itemEventId: event.itemEventId,
              offerId: event.offerId, fromActorId: event.fromActorId, fromActorRole: event.fromActorRole
            })),
            declines: events.filter(event => event.type === 'field-item-transfer-declined').map(event => ({
              id: event.id, actorId: event.actor.id, offerId: event.offerId
            }))
          };
        }""")
        assert event_summary['guildCreated'] == 1
        assert event_summary['guildJoined'] == 2
        assert set(event_summary['guildJoinActors']) == {
            witness_before['viewerId'], silent_before['viewerId']
        }
        assert len(event_summary['observations']) == 2
        assert {item['actorId'] for item in event_summary['observations']} == {
            founder_before['viewerId'], witness_before['viewerId']
        }
        assert silent_before['viewerId'] not in {item['actorId'] for item in event_summary['observations']}
        assert event_summary['challengeActors'] == [witness_before['viewerId']]
        assert event_summary['responseActors'] == [founder_before['viewerId']]
        assert len(event_summary['contributions']) == 1
        assert event_summary['contributions'][0]['actorId'] == witness_before['viewerId']
        assert event_summary['contributions'][0]['creationId'] == observatory_fixture['creationId']
        assert event_summary['contributions'][0]['version'] == observatory_fixture['version']
        assert len(event_summary['forges']) == 2
        ward_forge = next(item for item in event_summary['forges'] if item['sourceEventId'] == challenge_event_id)
        assert ward_forge['actorId'] == witness_before['viewerId']
        assert ward_forge['slotId'] == 'adversarial'
        second_forge = next(item for item in event_summary['forges'] if item['sourceEventId'] == contribution_event_id)
        assert second_forge['id'] == second_forge_event_id
        assert second_forge['actorId'] == witness_before['viewerId']
        assert second_forge['slotId'] == 'observation'
        assert len(event_summary['equips']) == 2
        assert {item['actorId'] for item in event_summary['equips']} == {
            witness_before['viewerId'], founder_before['viewerId']
        }
        assert all(item['slotId'] == 'adversarial' and item['sourceEventId'] == forge_event_id
                   for item in event_summary['equips'])
        recipient_equip_events = [
            item for item in event_summary['equips']
            if item['actorId'] == founder_before['viewerId']
        ]
        assert len(recipient_equip_events) == 1
        assert recipient_equip_events[0]['id'] == recipient_equip_event_id
        assert len(event_summary['unequips']) == 1
        assert event_summary['unequips'][0]['actorId'] == witness_before['viewerId']
        assert event_summary['unequips'][0]['slotId'] == 'adversarial'
        assert len(event_summary['transferOffers']) == 2
        accepted_offer = next(item for item in event_summary['transferOffers']
                              if item['itemEventId'] == forge_event_id)
        declined_offer = next(item for item in event_summary['transferOffers']
                              if item['itemEventId'] == second_forge_event_id)
        assert accepted_offer['actorId'] == witness_before['viewerId']
        assert accepted_offer['offerId'] == transfer_offer['offerId']
        assert accepted_offer['recipientId'] == founder_before['viewerId']
        assert accepted_offer['recipientRole'] == 'founder'
        assert declined_offer['actorId'] == witness_before['viewerId']
        assert declined_offer['offerId'] == decline_offer_id
        assert declined_offer['recipientId'] == founder_before['viewerId']
        assert declined_offer['recipientRole'] == 'founder'
        assert len(event_summary['declines']) == 1
        assert event_summary['declines'][0]['id'] == decline_event_id
        assert event_summary['declines'][0]['actorId'] == founder_before['viewerId']
        assert event_summary['declines'][0]['offerId'] == decline_offer_id
        assert len(event_summary['transfers']) == 1
        assert event_summary['transfers'][0]['actorId'] == founder_before['viewerId']
        assert event_summary['transfers'][0]['itemEventId'] == forge_event_id
        assert event_summary['transfers'][0]['id'] == transfer_event_id
        assert event_summary['transfers'][0]['offerId'] == transfer_offer['offerId']
        assert event_summary['transfers'][0]['fromActorId'] == witness_before['viewerId']
        assert event_summary['transfers'][0]['fromActorRole'] == 'witness'
        assert all(item['sourceRetrieval'] == 'NOT_PERFORMED' for item in event_summary['observations'])
        assert all(item['independentVerification'] == 'NOT_PERFORMED' for item in event_summary['observations'])
        assert all(item['modelAssertions'] == 'LEADS_ONLY' for item in event_summary['observations'])
        assert event_summary['challenges'] == 1
        assert event_summary['responses'] == 1

        # A completed circuit must open a fresh round. New notes, challenge and
        # response are distinct retained actions; the first round is not reused.
        after_first_round = authoritative_snapshot(founder_page)
        # Pin the 320px silent member's board before the next shared round.
        silent_board_baseline = open_quest_board_current(
            silent_page, 'witness', 2, '0/4'
        )
        assert silent_board_baseline['revision'] >= after_first_round['revision']
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
        # The 390px Witness opens after the challenge but before the original author responds.
        witness_board_baseline = open_quest_board_current(
            witness_page, 'witness', 2, '3/4'
        )
        founder_page.wait_for_function(
            "(expected) => Number(document.querySelector('#world')?.dataset.worldRevision) >= expected",
            arg=witness_board_baseline['revision']
        )
        before_final_response = authoritative_snapshot(founder_page)
        assert before_final_response['revision'] == witness_board_baseline['revision'], (
            'The author response must follow the exact accepted snapshot pinned by the Witness board.'
        )
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
        assert after_second_founder['revision'] == before_final_response['revision'] + 1, (
            'Only the original-author response may follow the Witness board snapshot in this final step.'
        )
        for pinned_page in (silent_page, witness_page):
            pinned_page.wait_for_function(
                "(expected) => Number(document.querySelector('#world')?.dataset.worldRevision) === expected",
                arg=after_second_founder['revision']
            )
        quest_board_refresh_silent_320 = assert_quest_board_snapshot_refresh(
            silent_page, 'witness', 2, '0/4', after_second_founder['revision'],
            out / 'quest-board-snapshot-refresh-silent-320.png'
        )
        quest_board_refresh_witness_390 = assert_quest_board_snapshot_refresh(
            witness_page, 'witness', 2, '3/4', after_second_founder['revision'],
            out / 'quest-board-snapshot-refresh-witness-390.png'
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
            guildJoinActors: events.filter(event => event.type === 'guild-joined').map(event => event.actor.id),
            observations: observations.map(event => ({
              id: event.id,
              actorId: event.actor.id,
              actorRole: event.actor.role,
              sourceRetrieval: event.sourceRetrieval,
              independentVerification: event.independentVerification,
              modelAssertions: event.modelAssertions
            })),
            challengeActors: events.filter(event => event.type === 'source-observation-challenged').map(event => event.actor.id),
            responseActors: events.filter(event => event.type === 'source-observation-challenge-responded').map(event => event.actor.id),
            challenges: count('source-observation-challenged'),
            responses: count('source-observation-challenge-responded')
          };
        }""")
        assert full_event_summary['guildCreated'] == 1
        assert full_event_summary['guildJoined'] == 2
        assert set(full_event_summary['guildJoinActors']) == {
            witness_before['viewerId'], silent_before['viewerId']
        }
        assert len(full_event_summary['observations']) == 4
        assert {item['actorId'] for item in full_event_summary['observations']} == {
            founder_before['viewerId'], witness_before['viewerId']
        }
        assert silent_before['viewerId'] not in {item['actorId'] for item in full_event_summary['observations']}
        assert set(full_event_summary['challengeActors']) == {witness_before['viewerId']}
        assert len(full_event_summary['challengeActors']) == 2
        assert set(full_event_summary['responseActors']) == {founder_before['viewerId']}
        assert len(full_event_summary['responseActors']) == 2
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
        silent_page.reload(wait_until='networkidle')
        silent_page.locator('#start-shared').tap()
        silent_page.locator('#world').wait_for(state='visible')
        silent_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        founder_persisted = authoritative_snapshot(founder_page)
        witness_persisted = authoritative_snapshot(witness_page)
        silent_persisted = authoritative_snapshot(silent_page)
        assert silent_persisted['viewerId'] == silent_before['viewerId'], (
            'The silent member must recover the same actor identity after reload.'
        )
        assert shared_world_snapshot(founder_persisted) == shared_world_snapshot(witness_persisted)
        assert shared_world_snapshot(founder_persisted) == shared_world_snapshot(silent_persisted)

        founder_before_board = authoritative_snapshot(founder_page)
        witness_before_board = authoritative_snapshot(witness_page)
        open_quest_board(founder_page)
        assert_board(founder_page, 'founder')
        assert_contradiction_ward_objectives(founder_page, 'founder', '0/1')
        assert_carry_forward_objective(founder_page, 'founder', '0/1')
        assert_armor_bearer_delivery_objective(founder_page, 'founder', '2/4', complete=False)
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
        assert_contradiction_ward_objectives(witness_page, 'witness', '1/1')
        assert_carry_forward_objective(witness_page, 'witness', '1/1')
        assert_armor_bearer_delivery_objective(witness_page, 'witness', '1/4', complete=False)
        assert_armor_bearer_chain_objective(
            witness_page, 'witness', recipient_equip_event_id, '4/4', complete=True
        )
        assert_circuit_progress(witness_page, 'witness', '4/4', complete=True)
        assert_circuit_round_progress(witness_page, 'witness', 2, '4/4', complete=True)
        assert_circuit_round_progress(witness_page, 'witness', 3, '0/4', complete=False)
        witness_after_board = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(witness_after_board) == shared_world_snapshot(witness_before_board)

        open_quest_board(silent_page)
        # Walking from Evidence Archive to Quest Board can append a legitimate discovery.
        # Start the read-only inspection baseline after that route/entry, not before navigation.
        silent_before_board = authoritative_snapshot(silent_page)
        assert_board(silent_page, 'witness')
        assert_contradiction_ward_objectives(silent_page, 'witness', '0/1')
        assert_carry_forward_objective(silent_page, 'witness', '0/1')
        assert_armor_bearer_delivery_objective(silent_page, 'witness', '0/4', complete=False)
        assert_circuit_progress(silent_page, 'witness', '4/4', complete=True)
        assert_circuit_round_progress(silent_page, 'witness', 2, '4/4', complete=True)
        assert_circuit_round_progress(silent_page, 'witness', 3, '0/4', complete=False)
        silent_after_board = authoritative_snapshot(silent_page)
        assert shared_world_snapshot(silent_after_board) == shared_world_snapshot(silent_before_board), (
            'The silent member can inspect the completed shared objective without mutating world state.'
        )

        founder_screenshot = out / 'guild-dissent-circuit-founder-390.png'
        witness_screenshot = out / 'guild-dissent-circuit-witness-390.png'
        silent_screenshot = out / 'guild-dissent-circuit-silent-member-320.png'
        founder_page.screenshot(path=str(founder_screenshot), full_page=True)
        witness_page.screenshot(path=str(witness_screenshot), full_page=True)
        silent_page.screenshot(path=str(silent_screenshot), full_page=True)
        founder_quest_evidence_chronicle = inspect_quest_evidence_event(
            founder_page, 'founder-guild-dissent-circuit', source_observation_event_id,
            'source-observation-recorded', out / 'quest-evidence-chronicle-founder-390.png'
        )
        silent_quest_evidence_chronicle = inspect_quest_evidence_event(
            silent_page, 'witness-guild-dissent-circuit', challenge_event_id,
            'source-observation-challenged', out / 'quest-evidence-chronicle-silent-320.png'
        )
        assert not witness_errors, 'Witness browser page errors: ' + json.dumps(witness_errors)
        assert not silent_errors, 'Silent-member browser page errors: ' + json.dumps(silent_errors)

        founder_page.locator('#sheet-close').tap()
        witness_page.locator('#sheet-close').tap()
        silent_page.locator('#sheet-close').tap()

        # The same retained two-round circuit must appear in both contributors'
        # records, while a current member who authored none receives zero.
        founder_character = assert_deliberator_character_record(
            founder_page, 'founder', 2, out / 'deliberator-founder-390.png',
            expected_armor_bearer=0
        )
        witness_character = assert_deliberator_character_record(
            witness_page, 'witness', 2, out / 'deliberator-witness-390.png',
            expected_armor_bearer=1
        )
        silent_character = assert_deliberator_character_record(
            silent_page, 'witness', 0, out / 'deliberator-silent-member-320.png',
            require_320px=True, expected_armor_bearer=0
        )
        assert founder_character['deliberatorRounds'] == witness_character['deliberatorRounds'] == 2
        assert founder_character['armorBearerTransfers'] == 0
        assert witness_character['armorBearerTransfers'] == 1
        assert silent_character['armorBearerTransfers'] == 0
        assert silent_character['deliberatorRounds'] == 0
        assert founder_character['readOnly'] and witness_character['readOnly'] and silent_character['readOnly']
        assert founder_character['xpUnchanged'] and witness_character['xpUnchanged'] and silent_character['xpUnchanged']

        # Add enough retained handoffs to cross the 12-record page boundary.
        # These are real shared actions by the two pseudonymous session actors;
        # they are not evidence of distinct humans and award no XP.
        history_action_before = authoritative_snapshot(founder_page)
        history_offer_ids = []
        for index in range(11):
            offer_payload = post_action(witness_page, {
                'type': 'offer-field-item-transfer',
                'itemEventId': second_forge_event_id,
                'recipientId': founder_before['viewerId'],
                'recipientRole': 'founder',
                'requestId': f'quest-board-history-page-offer-{index}'
            })
            offer_id = offer_payload.get('result', {}).get('offerId')
            assert isinstance(offer_id, str) and offer_id
            decline_payload = post_action(founder_page, {
                'type': 'decline-field-item-transfer',
                'offerId': offer_id,
                'requestId': f'quest-board-history-page-decline-{index}'
            })
            assert decline_payload.get('ok') is not False
            history_offer_ids.append(offer_id)
        history_action_after = authoritative_snapshot(founder_page)
        assert history_action_after['revision'] == history_action_before['revision'] + 22
        assert history_action_after['xp'] == history_action_before['xp'], (
            'Repeated retained offers and refusals must not award XP.'
        )

        if founder_page.locator('#sheet').is_visible():
            founder_page.locator('#sheet-close').tap()
        founder_page.locator('#character-button').tap()
        founder_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        handoff_history = founder_page.locator(
            '#sheet-content [data-field-item-participant-history]'
        )
        expect(handoff_history).to_have_count(1)
        expect(handoff_history).to_have_attribute('data-history-total', '13')
        expect(handoff_history).to_have_attribute('data-history-page', '0')
        expect(handoff_history).to_have_attribute('data-history-pages', '2')
        expect(handoff_history).to_have_attribute('data-history-has-older', 'true')
        expect(handoff_history).to_have_attribute('data-history-has-newer', 'false')
        expected_history_ids = founder_page.evaluate("""async founderId => {
          const response = await fetch('/api/state', {cache:'no-store',credentials:'same-origin'});
          if (!response.ok) throw new Error('Could not inspect participant history page fixture.');
          const dto = await response.json();
          return dto.world.events.filter(event =>
            event.type === 'field-item-transfer-offered' &&
            ((event.actor.id === founderId && event.actor.role === 'founder') ||
             (event.recipientId === founderId && event.recipientRole === 'founder'))
          ).map(event => event.offerId);
        }""", founder_before['viewerId'])
        assert len(expected_history_ids) == 13
        newest_page_ids = handoff_history.locator(
            '[data-field-item-participant-history-entry]'
        ).evaluate_all("nodes => nodes.map(node => node.getAttribute('data-field-item-participant-history-entry'))")
        assert newest_page_ids == expected_history_ids[-12:], (
            'The newest bounded page must preserve exact retained append order.'
        )
        expect(handoff_history.locator(
            '[data-field-item-participant-history-entry="' + transfer_offer['offerId'] + '"]'
        )).to_have_count(0)
        expect(handoff_history.locator(
            '[data-field-item-participant-history-entry="' + decline_offer_id + '"]'
        )).to_have_count(1)
        source_row = handoff_history.locator(
            '[data-field-item-participant-history-entry="' + decline_offer_id + '"]'
        )
        source_button = source_row.locator('[data-field-item-history-source]')
        expect(source_button).to_have_count(1)
        expect(source_button).to_have_attribute('data-source-action-type', 'creation')
        expect(source_button).to_have_attribute(
            'data-source-creation-id', observatory_fixture['creationId']
        )
        expect(source_button).to_have_attribute(
            'data-source-version', str(observatory_fixture['version'])
        )
        history_source_before = authoritative_snapshot(founder_page)
        source_button.tap()
        expect(founder_page.locator('#sheet-title')).to_have_text('Guild Dissent Circuit source')
        expect(founder_page.locator('#version-select')).to_have_value(str(observatory_fixture['version']))
        source_inspection_after = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(source_inspection_after) == shared_world_snapshot(history_source_before), (
            'Returning from participant handoff history to its exact retained source version must be read-only.'
        )
        assert source_inspection_after['xp'] == history_source_before['xp']
        founder_page.locator('#sheet-close').tap()
        founder_page.locator('#character-button').tap()
        founder_page.wait_for_function(
            "() => document.querySelector('#sheet-title')?.textContent === 'Character & field record' && "
            "!document.querySelector('#sheet').hidden"
        )
        handoff_history = founder_page.locator(
            '#sheet-content [data-field-item-participant-history]'
        )
        expect(handoff_history).to_have_attribute('data-history-page', '0')
        history_read_before = authoritative_snapshot(founder_page)
        older_button = handoff_history.locator('[data-field-item-history-older]')
        expect(older_button).to_be_visible()
        older_button.focus()
        older_button.tap()
        expect(handoff_history).to_have_attribute('data-history-page', '1')
        expect(handoff_history).to_have_attribute('data-history-has-newer', 'true')
        expect(handoff_history).to_have_attribute('data-history-has-older', 'false')
        page_status = handoff_history.locator('[data-field-item-history-page-status]')
        expect(page_status).to_have_count(1)
        expect(page_status).to_have_attribute('role', 'status')
        expect(page_status).to_have_attribute('aria-live', 'polite')
        expect(page_status).to_have_attribute('aria-atomic', 'true')
        expect(page_status).to_contain_text('Showing entries 1–1 of 13')
        expect(page_status).to_contain_text('Page 2 of 2')
        newer_button = handoff_history.locator('[data-field-item-history-newer]')
        expect(newer_button).to_have_attribute('aria-describedby', 'field-item-history-page-status')
        expect(newer_button).to_have_attribute('aria-controls', 'field-item-history-entries')
        expect(newer_button).to_be_focused()
        older_page_ids = handoff_history.locator(
            '[data-field-item-participant-history-entry]'
        ).evaluate_all("nodes => nodes.map(node => node.getAttribute('data-field-item-participant-history-entry'))")
        assert older_page_ids == expected_history_ids[:-12]
        expect(handoff_history.locator(
            '[data-field-item-participant-history-entry="' + transfer_offer['offerId'] + '"]'
        )).to_have_count(1)
        expect(handoff_history.locator(
            '[data-field-item-participant-history-entry="' + decline_offer_id + '"]'
        )).to_have_count(0)
        history_after_older = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(history_after_older) == shared_world_snapshot(history_read_before), (
            'Loading an older handoff page must be read-only.'
        )
        assert history_after_older['xp'] == history_read_before['xp']
        newer_button.focus()
        newer_button.tap()
        expect(handoff_history).to_have_attribute('data-history-page', '0')
        expect(page_status).to_contain_text('Showing entries 2–13 of 13')
        expect(page_status).to_contain_text('Page 1 of 2')
        older_button = handoff_history.locator('[data-field-item-history-older]')
        expect(older_button).to_have_attribute('aria-describedby', 'field-item-history-page-status')
        expect(older_button).to_have_attribute('aria-controls', 'field-item-history-entries')
        expect(older_button).to_be_focused()
        newest_again_ids = handoff_history.locator(
            '[data-field-item-participant-history-entry]'
        ).evaluate_all("nodes => nodes.map(node => node.getAttribute('data-field-item-participant-history-entry'))")
        assert newest_again_ids == expected_history_ids[-12:]
        history_after_newer = authoritative_snapshot(founder_page)
        assert shared_world_snapshot(history_after_newer) == shared_world_snapshot(history_read_before), (
            'Returning to newer handoff history must remain read-only.'
        )
        assert history_after_newer['xp'] == history_read_before['xp']
        handoff_history_screenshot = out / 'field-kit-handoff-history-pagination-390.png'
        founder_page.screenshot(path=str(handoff_history_screenshot), full_page=True)
        founder_page.locator('#sheet-close').tap()

        assert not witness_errors, 'Witness browser page errors: ' + json.dumps(witness_errors)
        assert not silent_errors, 'Silent-member browser page errors: ' + json.dumps(silent_errors)

        return {
            'passed': True,
            'threeSeparateBrowserContexts': True,
            'founderActorId': founder_before['viewerId'],
            'witnessActorId': witness_before['viewerId'],
            'silentMemberActorId': silent_before['viewerId'],
            'guildId': guild_id,
            'sourceObservationIds': [founder_note['observationId'], witness_note['observationId']],
            'sourceObservationQueueMobile': {
                'founder390': queue_founder_390,
                'silentMember320': queue_silent_320
            },
            'eventSummary': event_summary,
            'contradictionWardDossier': ward_dossier,
            'contradictionWardTransfer': {
                'offerId': transfer_offer['offerId'],
                'offeredBy': witness_before['viewerId'],
                'acceptedBy': founder_before['viewerId'],
                'creatorPreserved': True,
                'dossierPreservedAfterReload': founder_transfer_dossier['readOnly'],
                'senderNoLongerOwnsItem': True,
                'recipientEquippedExactItem': True,
                'recipientEquipEventId': recipient_equip_event_id,
                'questCreditStayedWithChallenger': True
            },
            'armorBearerDeliveryQuestProgress': {
                'founder': '2/4', 'witnessCurrentItem': '1/4',
                'witnessCompletedHandoff': '4/4', 'silentMember': '0/4'
            },
            'secondFieldItem': {
                'contributionEventId': contribution_event_id,
                'forgeEventId': second_forge_event_id,
                'actionableQuestVisible': True,
                'pendingHandoffVisible': True
            },
            'worldReloadRecovered': True,
            'sharedWorldConverged': True,
            'founderQuestProgress': '4/4',
            'witnessQuestProgress': '4/4',
            'silentMemberQuestProgress': '4/4',
            'carryForwardQuestProgress': {
                'founder': '0/1', 'witness': '1/1', 'silentMember': '0/1'
            },
            'armorBearerSkillCounts': {
                'founder': founder_character['armorBearerTransfers'],
                'witness': witness_character['armorBearerTransfers'],
                'silentMember': silent_character['armorBearerTransfers']
            },
            'completedRounds': 2,
            'nextRoundProgress': '0/4',
            'secondRoundObservationIds': [
                founder_round_two_note['observationId'], witness_round_two_note['observationId']
            ],
            'secondRoundEventSummary': full_event_summary,
            'questBoardSnapshotRefresh': {
                'silentMember320': quest_board_refresh_silent_320,
                'witness390': quest_board_refresh_witness_390
            },
            'noXpAwarded': after_second_founder['xp'] == founder_before['xp'],
            'boardInspectionReadOnly': True,
            'characterProjectionReadOnly': True,
            'founderCharacterRecord': founder_character,
            'witnessCharacterRecord': witness_character,
            'silentMemberCharacterRecord': silent_character,
            'silentMemberReceivesNoParticipationCredit': silent_character['deliberatorRounds'] == 0,
            'handoffHistoryPagination': {
                'participantOfferCount': len(expected_history_ids),
                'pageSize': 12,
                'newestPageCount': len(newest_page_ids),
                'olderPageCount': len(older_page_ids),
                'appendOrderPreserved': newest_page_ids == expected_history_ids[-12:] and older_page_ids == expected_history_ids[:-12],
                'olderAndNewerNavigationReadOnly': shared_world_snapshot(history_after_newer) == shared_world_snapshot(history_read_before),
                'xpDelta': history_after_newer['xp'] - history_read_before['xp']
            },
            'declinedChronicleCard': declined_chronicle_card,
            'itemHistoryChronicleNavigation': item_history_chronicle_navigation,
            'itemHistoryChronicleNavigation320': item_history_chronicle_navigation_320,
            'questEvidenceChronicleNavigation': {
                'founder390': founder_quest_evidence_chronicle,
                'silentMember320': silent_quest_evidence_chronicle
            },
            'eventChainNavigation': {
                'declinedEventKinds': chain_navigation_results,
                'declinedChainComplete': chain_navigation_results == ['source', 'forge', 'offer', 'declined'],
                'declinedLinkOrderPreserved': actual_chain_kinds == ['source', 'forge', 'offer', 'declined'],
                'acceptedLinkOrderPreserved': accepted_chain_kinds == ['source', 'forge', 'offer', 'accepted'],
                'acceptedOutcomeNavigable': True,
                'xpDeltas': chain_navigation_xp_deltas + [accepted_chain_xp_delta],
                'allInspectionsReadOnly': all(delta == 0 for delta in chain_navigation_xp_deltas + [accepted_chain_xp_delta])
            },
            'pageErrors': witness_errors + silent_errors,
            'screenshots': [
                founder_screenshot.name, witness_screenshot.name, silent_screenshot.name,
                ward_dossier['screenshot'], founder_transfer_dossier['screenshot'],
                founder_character['screenshot'], witness_character['screenshot'],
                silent_character['screenshot'], handoff_history_screenshot.name,
                item_history_chronicle_screenshot.name
            ]
        }
    finally:
        silent_context.close()
        witness_context.close()


def open_source_analyst_workbench(page, baseline, expected_progress='0/2'):
    control = page.locator('[data-guild-npc-control="source-analyst"]')
    expect(control).to_have_count(1)
    control.evaluate('(button) => button.focus()')
    expect(control).to_be_visible()
    page.wait_for_function(
        """() => {
          const world = document.querySelector('#world');
          const control = document.querySelector('[data-guild-npc-control="source-analyst"]');
          return world?.dataset.nearbyNpcRole === 'source-analyst' &&
            control?.dataset.guildNpcAction === 'talk';
        }""",
        timeout=45000
    )
    routed = authoritative_snapshot(page)
    route_read_only = (
        routed['eventIds'] == baseline['eventIds'] and
        routed['xp'] == baseline['xp'] and
        routed['creationVersions'] == baseline['creationVersions']
    )
    assert route_read_only, (
        'Quest navigation to the Source Analyst may move the session, but must not append evidence, '
        'predicate events, XP, or creation versions.'
    )
    control.tap()
    page.wait_for_function(
        """() => {
          const sheet = document.querySelector('#sheet');
          const title = document.querySelector('#sheet-title');
          const card = document.querySelector('#sheet-content [data-local-npc-role="source-analyst"]');
          return sheet && !sheet.hidden && title?.textContent === 'Moonshot Field' &&
            card && document.activeElement === card;
        }""",
        timeout=10000
    )
    after_talk = authoritative_snapshot(page)
    talk_read_only = (
        after_talk['eventIds'] == routed['eventIds'] and
        after_talk['xp'] == routed['xp'] and
        after_talk['creationVersions'] == routed['creationVersions']
    )
    assert talk_read_only, (
        'Talking to the fixed Source Analyst must not append evidence, progress, XP, or authority.'
    )
    card = page.locator('#sheet-content [data-local-npc-role="source-analyst"]')
    expect(card).to_have_count(1)
    expect(card).to_contain_text('BOUNDED RESEARCH GUIDE')
    expect(card).to_contain_text('This NPC makes no AI/model or provider call')
    expect(card).to_contain_text('not a claim verdict')
    expect(card).to_contain_text('Approach and Talk create no evidence, progress, or XP')
    contrast_status = card.locator('[data-source-analyst-contrast-status="true"]')
    expect(contrast_status).to_have_count(1)
    expect(contrast_status).to_have_attribute('data-source-analyst-progress', expected_progress)
    expect(contrast_status).to_contain_text(expected_progress)
    expect(contrast_status).to_contain_text('Read-only projection of this session')
    if expected_progress == '0/2':
        expect(contrast_status).to_contain_text('No actor-attributed byte-predicate result is retained')
    elif expected_progress == '1/2':
        expect(contrast_status).to_contain_text('No valid opposite-outcome pair is retained yet')
    elif expected_progress == '2/2':
        expect(contrast_status).to_contain_text('Both operators produced opposite byte outcomes')
    else:
        raise AssertionError('Unexpected Source Analyst contrast progress fixture: ' + expected_progress)
    predicate_form = page.locator('#sheet-content [data-source-predicate-form="true"]')
    expect(predicate_form).to_have_count(1)
    expect(predicate_form.locator('#source-predicate-source')).to_be_enabled()
    card_focused = page.evaluate(
        "document.activeElement?.dataset.localNpcRole === 'source-analyst'"
    )
    assert card_focused, 'The NPC interaction must focus the exact Source Analyst workbench card.'
    return {
        'npcId': 'local-npc-source-analyst',
        'routeReadOnly': route_read_only,
        'talkReadOnly': talk_read_only,
        'cardFocused': card_focused,
        'noModelCall': True,
        'workbenchVisible': True,
        'contrastProgress': expected_progress,
        'contrastStatus': contrast_status.get_attribute('data-source-analyst-status')
    }


def run_source_archive_quest_chain(page, role, archive, out, suffix):
    actor = authoritative_snapshot(page)
    assert actor['viewerRole'] == role, 'Source Archive quest must run as the intended actor.'
    assert isinstance(archive.get('creationId'), str) and archive['creationId']
    assert archive.get('version') == 1
    chain_start = authoritative_snapshot(page)

    # The board is a read-only projection, and the first objective routes to the
    # actual Moonshot Field rather than granting progress when the player reads it.
    open_quest_board(page)
    board_before_inspection = authoritative_snapshot(page)
    assert_board(page, role)
    assert_source_archive_objectives(page, role, '0/1', '0/1')
    board_after = authoritative_snapshot(page)
    assert board_after == board_before_inspection, 'Inspecting the uncompleted Source Archive objectives must be read-only.'
    proposal_row = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-moonshot"]'
    )
    proposal_action = proposal_row.get_by_role('button', name='Go do this →', exact=True)
    expect(proposal_action).to_be_visible()
    proposal_action.tap()
    enter_nearby_institution(page, 'moonshot_field', 'Moonshot Field', 'Moonshot Field')
    source_analyst_hidden_until_talk = page.locator('#source-analyst-npc').count() == 0
    assert source_analyst_hidden_until_talk, (
        'Direct Moonshot Field entry must not expose the fixed-local Source Analyst workbench before explicit NPC Talk.'
    )

    proposal_title = 'Source Archive workflow · ' + role.title()
    proposal_before = authoritative_snapshot(page)
    page.locator('#moonshot-title').fill(proposal_title)
    page.locator('#moonshot-hypothesis').fill(
        'One exact published Source Archive version can be retained as the source of a falsifiable Moonshot proposal.'
    )
    page.locator('#moonshot-falsifier').fill(
        'The retained proposal references a different creation or version from the published archive.'
    )
    page.locator('#moonshot-evidence').fill(
        'One earlier publication event and the exact retained creation/version reference.'
    )
    page.locator('#moonshot-source').select_option(value=archive['creationId'])
    page.wait_for_function(
        "() => document.querySelector('#moonshot-source-version') && !document.querySelector('#moonshot-source-version').disabled"
    )
    page.locator('#moonshot-source-version').select_option(value=str(archive['version']))
    page.locator('#propose-moonshot').tap()
    page.wait_for_function(
        """expected => Array.from(document.querySelectorAll('#sheet-content [data-moonshot-id]'))
          .some(card => card.textContent.includes(expected.title))""",
        arg={'title': proposal_title}
    )
    expect(page.locator('#sheet-content')).to_contain_text('PROPOSED · NOT EXECUTED')
    proposal_after = authoritative_snapshot(page)
    assert proposal_after['revision'] == proposal_before['revision'] + 1, (
        'Retaining the Moonshot proposal must append exactly one proposal event.'
    )
    assert proposal_after['xp'] == proposal_before['xp'], (
        'A proposal is a retained research question, not XP or an experiment result.'
    )
    proposal_details = source_archive_research_snapshot(
        page, actor['viewerId'], role, archive, proposal_title, False
    )
    assert proposal_details['proposalSourceCreationId'] == archive['creationId']
    assert proposal_details['proposalSourceVersion'] == archive['version']

    page.locator('#sheet-close').tap()
    open_quest_board(page)
    proposal_board_before = authoritative_snapshot(page)
    assert_board(page, role)
    assert_source_archive_objectives(page, role, '1/1', '0/1')
    proposal_board_after = authoritative_snapshot(page)
    assert proposal_board_after == proposal_board_before, (
        'The proposal milestone is a read-only projection of the retained proposal event.'
    )

    # The second objective's own route must resolve to the retained proposal object.
    experiment_row = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-experiment"]'
    )
    experiment_action = experiment_row.get_by_role('button', name='Go do this →', exact=True)
    expect(experiment_action).to_be_visible()
    experiment_action.tap()
    page.wait_for_function(
        """() => document.querySelector('#sheet-title')?.textContent === 'Moonshot Field' &&
          !document.querySelector('#sheet').hidden &&
          document.querySelector('#sheet-content [data-moonshot-id]')"""
    )
    proposal_card = page.locator(
        f'#sheet-content [data-moonshot-id="{proposal_details["proposalId"]}"]'
    )
    expect(proposal_card).to_have_count(1)
    expect(proposal_card).to_contain_text(proposal_title)
    expect(proposal_card).to_contain_text('Inspect linked source v1')
    proposal_card.get_by_role(
        'button', name='Record an experiment attempt →', exact=True
    ).tap()
    page.locator('#report-experiment').wait_for(state='visible')

    report_before = authoritative_snapshot(page)
    page.locator('#experiment-procedure').fill(
        'Exercise the server-rechecked route against the deterministic mock GitHub Contents API fixture; no external network request is made.'
    )
    page.locator('#experiment-observation').fill(
        'The server-created archive matches the pinned mock fixture bytes and digests; this does not establish a real GitHub retrieval, authorship, source truth, or independent verification.'
    )
    page.locator('#experiment-outcome').select_option(value='failed')
    page.locator('#experiment-evidence-source').select_option(value=archive['creationId'])
    page.wait_for_function(
        "() => document.querySelector('#experiment-evidence-version') && !document.querySelector('#experiment-evidence-version').disabled"
    )
    page.locator('#experiment-evidence-version').select_option(value=str(archive['version']))
    page.locator('#report-experiment').tap()
    page.wait_for_function(
        "() => document.querySelector('#sheet-content')?.textContent.includes('SELF-REPORTED · NOT ADJUDICATED')"
    )
    expect(page.locator('#sheet-content')).to_contain_text('Reported outcome: failed')
    expect(page.locator('#sheet-content')).to_contain_text('mock fixture bytes and digests')
    expect(page.locator('#sheet-content')).to_contain_text('does not establish a real GitHub retrieval')
    report_after = authoritative_snapshot(page)
    assert report_after['revision'] == report_before['revision'] + 1, (
        'Retaining the failed experiment attempt must append exactly one report event.'
    )
    assert report_after['xp'] == report_before['xp'], (
        'A failed self-reported experiment attempt is not XP, verification, or approval.'
    )
    research_details = source_archive_research_snapshot(
        page, actor['viewerId'], role, archive, proposal_title, True
    )
    assert research_details['reportOutcome'] == 'failed'
    assert research_details['reportEvidenceCreationId'] == archive['creationId']
    assert research_details['reportEvidenceVersion'] == archive['version']
    assert research_details['reportIndex'] > research_details['proposalIndex'] > research_details['publicationIndex']

    page.locator('#sheet-close').tap()
    open_quest_board(page)
    predicate_board_before = authoritative_snapshot(page)
    assert_board(page, role)
    assert_source_archive_objectives(page, role, '1/1', '1/1', '0/1')
    predicate_board_after = authoritative_snapshot(page)
    assert predicate_board_after == predicate_board_before, (
        'Reading the uncompleted Source Archive predicate objective must be read-only.'
    )
    predicate_row = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-predicate"]'
    )
    predicate_action = predicate_row.get_by_role('button', name='Go do this →', exact=True)
    expect(predicate_action).to_be_visible()
    predicate_before_navigation = authoritative_snapshot(page)
    predicate_action.tap()
    predicate_source_analyst = open_source_analyst_workbench(page, predicate_before_navigation, '0/2')
    predicate_form = page.locator('#sheet-content [data-source-predicate-form="true"]')
    expect(predicate_form).to_have_count(1)
    expect(predicate_form).to_contain_text('MATCH / NO_MATCH')
    expect(predicate_form).to_contain_text('use both literal operators on the same exact literal and published Source Archive version')
    retention_notice = predicate_form.locator('[data-source-predicate-public-retention="true"]')
    expect(retention_notice).to_be_visible()
    expect(retention_notice).to_contain_text('SHARED-WORLD RETENTION')
    expect(retention_notice).to_contain_text('visible to other players')
    expect(retention_notice).to_contain_text('actor ID and role')
    expect(retention_notice).to_contain_text('Source Archive version')
    expect(retention_notice).to_contain_text('SHA-256')
    expect(retention_notice).to_contain_text('acknowledgement version')
    expect(retention_notice).to_contain_text('Do not enter passwords')
    acknowledgement_label = predicate_form.locator('[data-source-predicate-public-acknowledgement="true"]')
    expect(acknowledgement_label).to_contain_text('shared-world history')
    predicate_acknowledgement = predicate_form.locator('#source-predicate-public-ack')
    expect(predicate_acknowledgement).to_be_visible()
    expect(predicate_acknowledgement).not_to_be_checked()
    expect(predicate_acknowledgement).to_have_attribute('aria-describedby', 'source-predicate-retention-notice')
    predicate_submit = predicate_form.locator('#evaluate-source-predicate')
    expect(predicate_submit).to_be_disabled()
    predicate_source_value = json.dumps([archive['creationId'], archive['version']], separators=(',', ':'))
    predicate_literal = 'NGL_QUEST_BOARD_SERVER_RECHECK' if role == 'founder' else 'fixture-only'
    page.locator('#source-predicate-source').select_option(value=predicate_source_value)
    page.locator('#source-predicate-kind').select_option(value='contains-literal')
    expect(predicate_submit).to_be_disabled()
    page.locator('#source-predicate-literal').fill(predicate_literal)
    expect(predicate_submit).to_be_disabled()
    acknowledgement_box = predicate_acknowledgement.bounding_box()
    assert acknowledgement_box and acknowledgement_box['width'] >= 18 and acknowledgement_box['height'] >= 18, (
        'The public-retention checkbox must remain touch-sized on mobile.'
    )
    predicate_before_acknowledgement = authoritative_snapshot(page)
    predicate_form.evaluate('(form) => form.requestSubmit()')
    predicate_after_unacknowledged_submit = authoritative_snapshot(page)
    unacknowledged_submission_blocked = predicate_after_unacknowledged_submit == predicate_before_acknowledgement
    assert unacknowledged_submission_blocked, (
        'Submitting without the public-retention acknowledgement must not append an event.'
    )
    predicate_acknowledgement.check()
    expect(predicate_submit).to_be_enabled()
    predicate_after_acknowledgement = authoritative_snapshot(page)
    assert predicate_after_acknowledgement == predicate_before_acknowledgement, (
        'Acknowledging public retention is local UI state, not a world event or XP.'
    )
    predicate_acknowledgement.uncheck()
    expect(predicate_submit).to_be_disabled()
    predicate_after_uncheck = authoritative_snapshot(page)
    acknowledgement_did_not_mutate_world = (
        predicate_after_acknowledgement == predicate_before_acknowledgement and
        predicate_after_uncheck == predicate_before_acknowledgement
    )
    assert acknowledgement_did_not_mutate_world, (
        'Changing the local acknowledgement must not mutate the shared world.'
    )
    predicate_acknowledgement.check()
    expect(predicate_submit).to_be_enabled()
    predicate_before = authoritative_snapshot(page)
    predicate_submit.tap()
    page.wait_for_function(
        """expected => Array.from(document.querySelectorAll('#sheet-content [data-source-predicate-id]'))
          .some(card => card.textContent.includes(expected.literal) &&
            card.textContent.includes('Source predicate · MATCH'))""",
        arg={'literal': predicate_literal}
    )
    predicate_card = page.locator('#sheet-content [data-source-predicate-id]').filter(
        has_text=predicate_literal
    )
    expect(predicate_card).to_have_count(1)
    expect(predicate_card).to_contain_text('Source predicate · MATCH')
    expect(predicate_card).to_contain_text('Byte predicate only')
    expect(predicate_card).to_contain_text('NOT_ASSESSED / NOT_PERFORMED')
    first_progress_card = page.locator(
        '#sheet-content [data-source-analyst-contrast-status="true"]'
    )
    expect(first_progress_card).to_have_count(1)
    expect(first_progress_card).to_have_attribute('data-source-analyst-progress', '1/2')
    first_progress_value = first_progress_card.get_attribute('data-source-analyst-progress')
    assert first_progress_value == '1/2'
    predicate_after = authoritative_snapshot(page)
    assert predicate_after['revision'] == predicate_before['revision'] + 1, (
        'Evaluating one bounded Source Archive predicate must append exactly one event.'
    )
    assert predicate_after['xp'] == predicate_before['xp'], (
        'A byte-level predicate is not XP, truth adjudication, or authority.'
    )
    predicate_details = page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Predicate event state read failed: ' + response.status);
      const dto = await response.json();
      const matches = dto.world.events.filter(event =>
        event?.type === 'source-archive-predicate-evaluated' &&
        event.actor?.id === expected.actorId && event.actor?.role === expected.actorRole &&
        event.creationId === expected.creationId && event.version === expected.version &&
        event.literal === expected.literal
      );
      if (matches.length !== 1) throw new Error('Expected one actor-scoped retained predicate event.');
      const event = matches[0];
      return {
        eventId: event.id, predicateId: event.predicateId, outcome: event.outcome,
        sourceTruth: event.sourceTruth, independentVerification: event.independentVerification,
        modelAssertions: event.modelAssertions, retrievalMode: event.retrievalMode,
        sourceSha256: event.sourceSha256, sourceSize: event.sourceSize,
        evaluator: event.evaluator, observedBy: event.observedBy,
        executionContext: event.executionContext,
        publicRetentionAcknowledgementVersion: event.publicRetentionAcknowledgementVersion
      };
    }""", {
        'actorId': actor['viewerId'], 'actorRole': role,
        'creationId': archive['creationId'], 'version': archive['version'],
        'literal': predicate_literal
    })
    assert predicate_details['outcome'] == 'MATCH'
    assert predicate_details['publicRetentionAcknowledgementVersion'] == 'ngl.source-predicate-public-retention.v1'
    assert predicate_details['sourceTruth'] == 'NOT_ASSESSED'
    assert predicate_details['independentVerification'] == 'NOT_PERFORMED'
    assert predicate_details['modelAssertions'] == 'LEADS_ONLY'
    assert predicate_details['retrievalMode'] == 'SERVER_RECHECKED'
    assert predicate_details['sourceSize'] == len(SOURCE_FIXTURE_BYTES)
    assert predicate_details['sourceSha256'] == SOURCE_FIXTURE_SHA256
    assert predicate_details['observedBy'] == 'shared-game-server'
    assert predicate_details['executionContext'] == 'shared-server'
    assert predicate_details['evaluator']

    repeat_button = predicate_card.get_by_role('button', name='Repeat this byte test', exact=True)
    expect(repeat_button).to_be_visible()
    repeat_before = authoritative_snapshot(page)
    repeat_button.tap()
    repeat_form = page.locator('#sheet-content [data-source-predicate-form="true"]')
    expect(repeat_form).to_have_count(1)
    expect(repeat_form.locator('#source-predicate-source')).to_have_value(predicate_source_value)
    expect(repeat_form.locator('#source-predicate-kind')).to_have_value('contains-literal')
    expect(repeat_form.locator('#source-predicate-literal')).to_have_value(predicate_literal)
    repeat_acknowledgement = repeat_form.locator('#source-predicate-public-ack')
    repeat_acknowledgement_was_reset = not repeat_acknowledgement.is_checked()
    expect(repeat_acknowledgement).not_to_be_checked()
    repeat_submit = repeat_form.locator('#evaluate-source-predicate')
    expect(repeat_submit).to_be_disabled()
    repeat_prefill = authoritative_snapshot(page)
    assert repeat_prefill == repeat_before, (
        'Repeating a retained predicate must only prefill the form, not mutate the world.'
    )
    repeat_acknowledgement.check()
    expect(repeat_submit).to_be_enabled()
    repeat_after_acknowledgement = authoritative_snapshot(page)
    assert repeat_after_acknowledgement == repeat_before, (
        'Re-acknowledging the repeated public predicate must remain local UI state.'
    )
    repeat_submit.tap()
    page.wait_for_function(
        """expected => Array.from(document.querySelectorAll('#sheet-content [data-source-predicate-id]'))
          .filter(card => card.textContent.includes(expected.literal) &&
            card.textContent.includes('Source predicate · MATCH')).length === 2""",
        arg={'literal': predicate_literal}
    )
    predicate_after_repeat = authoritative_snapshot(page)
    assert predicate_after_repeat['revision'] == predicate_after['revision'] + 1, (
        'Repeating one byte predicate must append exactly one new event.'
    )
    assert predicate_after_repeat['xp'] == predicate_after['xp'], (
        'Repeating a byte predicate must not award XP.'
    )
    repeat_details = page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Repeated predicate state read failed: ' + response.status);
      const dto = await response.json();
      const matches = dto.world.events.filter(event =>
        event?.type === 'source-archive-predicate-evaluated' &&
        event.actor?.id === expected.actorId && event.actor?.role === expected.actorRole &&
        event.creationId === expected.creationId && event.version === expected.version &&
        event.literal === expected.literal
      );
      return {
        eventIds: matches.map(event => event.id),
        predicateIds: matches.map(event => event.predicateId),
        outcomes: matches.map(event => event.outcome),
        sourceSha256s: matches.map(event => event.sourceSha256),
        sourceSizes: matches.map(event => event.sourceSize),
        acknowledgementVersions: matches.map(event => event.publicRetentionAcknowledgementVersion),
        actorIds: matches.map(event => event.actor.id),
        actorRoles: matches.map(event => event.actor.role)
      };
    }""", {
        'actorId': actor['viewerId'], 'actorRole': role,
        'creationId': archive['creationId'], 'version': archive['version'],
        'literal': predicate_literal
    })
    assert len(repeat_details['eventIds']) == 2
    assert len(set(repeat_details['eventIds'])) == 2
    assert len(set(repeat_details['predicateIds'])) == 2
    assert repeat_details['outcomes'] == [predicate_details['outcome'], predicate_details['outcome']]
    assert repeat_details['sourceSha256s'] == [predicate_details['sourceSha256']] * 2
    assert repeat_details['sourceSizes'] == [predicate_details['sourceSize']] * 2
    assert repeat_details['acknowledgementVersions'] == ['ngl.source-predicate-public-retention.v1'] * 2
    assert repeat_details['actorIds'] == [actor['viewerId']] * 2
    assert repeat_details['actorRoles'] == [role] * 2

    page.locator('#sheet-close').tap()
    open_quest_board(page)
    contrast_board_before = authoritative_snapshot(page)
    assert_board(page, role)
    assert_source_archive_objectives(page, role, '1/1', '1/1', '1/1', '1/2')
    contrast_board_after = authoritative_snapshot(page)
    assert contrast_board_after == contrast_board_before, (
        'Two MATCH predicates on one retained version must not complete the contrast objective.'
    )
    contrast_row = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-contrast"]'
    )
    contrast_action = contrast_row.get_by_role('button', name='Go do this →', exact=True)
    expect(contrast_action).to_be_visible()
    contrast_before_navigation = authoritative_snapshot(page)
    contrast_action.tap()
    contrast_source_analyst = open_source_analyst_workbench(page, contrast_before_navigation, '1/2')

    contrast_form = page.locator('#sheet-content [data-source-predicate-form="true"]')
    expect(contrast_form).to_have_count(1)
    contrast_form.locator('#source-predicate-source').select_option(value=predicate_source_value)
    contrast_form.locator('#source-predicate-kind').select_option(value='does-not-contain-literal')
    contrast_literal = predicate_literal
    assert contrast_literal.encode('utf-8') in SOURCE_FIXTURE_BYTES, (
        'The contrast predicate must reuse the exact known-present literal from the first operator.'
    )
    contrast_form.locator('#source-predicate-literal').fill(contrast_literal)
    contrast_acknowledgement = contrast_form.locator('#source-predicate-public-ack')
    expect(contrast_acknowledgement).not_to_be_checked()
    contrast_submit = contrast_form.locator('#evaluate-source-predicate')
    expect(contrast_submit).to_be_disabled()
    contrast_before_acknowledgement = authoritative_snapshot(page)
    contrast_acknowledgement.check()
    expect(contrast_submit).to_be_enabled()
    contrast_after_acknowledgement = authoritative_snapshot(page)
    assert contrast_after_acknowledgement == contrast_before_acknowledgement, (
        'Acknowledging the contrast predicate must remain local UI state.'
    )
    contrast_before = authoritative_snapshot(page)
    contrast_submit.tap()
    page.wait_for_function(
        """expected => Array.from(document.querySelectorAll('#sheet-content [data-source-predicate-id]'))
          .some(card => card.textContent.includes(expected.literal) &&
            card.textContent.includes('Source predicate · NO_MATCH'))""",
        arg={'literal': contrast_literal}
    )
    contrast_card = page.locator('#sheet-content [data-source-predicate-id]').filter(
        has_text=contrast_literal
    ).filter(has_text='Source predicate · NO_MATCH')
    expect(contrast_card).to_have_count(1)
    expect(contrast_card).to_contain_text('Source predicate · NO_MATCH')
    expect(contrast_card).to_contain_text('Byte predicate only')
    expect(contrast_card).to_contain_text('NOT_ASSESSED / NOT_PERFORMED')
    completed_progress_card = page.locator(
        '#sheet-content [data-source-analyst-contrast-status="true"]'
    )
    expect(completed_progress_card).to_have_count(1)
    expect(completed_progress_card).to_have_attribute('data-source-analyst-progress', '2/2')
    completed_progress_value = completed_progress_card.get_attribute('data-source-analyst-progress')
    assert completed_progress_value == '2/2'
    contrast_after = authoritative_snapshot(page)
    assert contrast_after['revision'] == contrast_before['revision'] + 1, (
        'The contrasting byte predicate must append exactly one retained event.'
    )
    assert contrast_after['xp'] == contrast_before['xp'], (
        'A NO_MATCH byte predicate must not award XP.'
    )
    contrast_details = page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Contrast predicate state read failed: ' + response.status);
      const dto = await response.json();
      const matches = dto.world.events.filter(event =>
        event?.type === 'source-archive-predicate-evaluated' &&
        event.actor?.id === expected.actorId && event.actor?.role === expected.actorRole &&
        event.creationId === expected.creationId && event.version === expected.version &&
        event.predicateKind === 'does-not-contain-literal' && event.literal === expected.literal
      );
      if (matches.length !== 1) throw new Error('Expected one actor-scoped NO_MATCH predicate event.');
      const event = matches[0];
      return {
        eventId: event.id, predicateId: event.predicateId, predicateKind: event.predicateKind,
        literal: event.literal, outcome: event.outcome,
        creationId: event.creationId, version: event.version,
        sourceTruth: event.sourceTruth, independentVerification: event.independentVerification,
        modelAssertions: event.modelAssertions, retrievalMode: event.retrievalMode,
        sourceSha256: event.sourceSha256, sourceSize: event.sourceSize,
        publicRetentionAcknowledgementVersion: event.publicRetentionAcknowledgementVersion
      };
    }""", {
        'actorId': actor['viewerId'], 'actorRole': role,
        'creationId': archive['creationId'], 'version': archive['version'],
        'literal': contrast_literal
    })
    assert contrast_details['predicateKind'] == 'does-not-contain-literal'
    assert contrast_details['literal'] == predicate_literal
    assert contrast_details['outcome'] == 'NO_MATCH'
    assert contrast_details['sourceTruth'] == 'NOT_ASSESSED'
    assert contrast_details['independentVerification'] == 'NOT_PERFORMED'
    assert contrast_details['modelAssertions'] == 'LEADS_ONLY'
    assert contrast_details['retrievalMode'] == 'SERVER_RECHECKED'
    assert contrast_details['sourceSha256'] == predicate_details['sourceSha256']
    assert contrast_details['sourceSize'] == predicate_details['sourceSize']
    assert contrast_details['publicRetentionAcknowledgementVersion'] == 'ngl.source-predicate-public-retention.v1'

    page.locator('#sheet-close').tap()
    completed_contrast_before_talk = authoritative_snapshot(page)
    complete_source_analyst = open_source_analyst_workbench(
        page, completed_contrast_before_talk, '2/2'
    )
    completed_status = page.locator(
        '#sheet-content [data-source-analyst-contrast-status="true"]'
    )
    completed_results = completed_status.locator('[data-source-analyst-result-event-id]')
    expect(completed_results).to_have_count(2)
    contrast_event_ids = [
        completed_results.nth(index).get_attribute('data-source-analyst-result-event-id')
        for index in range(2)
    ]
    assert contrast_event_ids == [predicate_details['eventId'], contrast_details['eventId']], (
        'The Source Analyst must expose the exact retained event pair used by this actor’s completed contrast.'
    )
    analyst_screenshot = out / ('source-analyst-contrast-' + role + '-' + suffix + '.png')
    page.screenshot(path=str(analyst_screenshot), full_page=True)
    history_before_inspection = authoritative_snapshot(page)
    completed_results.first.get_by_role(
        'button', name='Inspect retained result →', exact=True
    ).tap()
    page.wait_for_function(
        """expected => document.activeElement?.getAttribute('data-source-predicate-event-id') === expected""",
        arg=contrast_event_ids[0]
    )
    history_after_inspection = authoritative_snapshot(page)
    contrast_history_inspection_read_only = history_after_inspection == history_before_inspection
    assert contrast_history_inspection_read_only, (
        'Inspecting an exact retained predicate event must navigate locally without appending events or XP.'
    )

    # Keep the counted evidence pair reachable after the ordinary 12-event
    # history window rolls forward. Same-outcome repeats are real retained
    # observations, but they must not add quest progress or XP.
    history_padding_repeats = 13
    history_padding_event_ids = []
    source_analyst_submit_lock_observed = True
    for repeat_index in range(history_padding_repeats):
        latest_match_card = page.locator(
            '#sheet-content [data-source-predicate-id]'
        ).filter(has_text=predicate_literal).filter(
            has_text='Source predicate · MATCH'
        ).last
        expect(latest_match_card).to_have_count(1)
        padding_repeat_button = latest_match_card.get_by_role(
            'button', name='Repeat this byte test', exact=True
        )
        expect(padding_repeat_button).to_be_visible()
        padding_before = authoritative_snapshot(page)
        padding_repeat_button.tap()
        padding_form = page.locator('#sheet-content [data-source-predicate-form="true"]')
        expect(padding_form).to_have_count(1)
        expect(padding_form.locator('#source-predicate-source')).to_have_value(predicate_source_value)
        expect(padding_form.locator('#source-predicate-kind')).to_have_value('contains-literal')
        expect(padding_form.locator('#source-predicate-literal')).to_have_value(predicate_literal)
        padding_acknowledgement = padding_form.locator('#source-predicate-public-ack')
        expect(padding_acknowledgement).not_to_be_checked()
        padding_submit = padding_form.locator('#evaluate-source-predicate')
        expect(padding_submit).to_be_disabled()
        padding_prefill = authoritative_snapshot(page)
        assert padding_prefill == padding_before, (
            'Prefilling a history-padding repeat must not append an event or award XP.'
        )
        padding_acknowledgement.check()
        expect(padding_submit).to_be_enabled()
        padding_acknowledged = authoritative_snapshot(page)
        assert padding_acknowledged == padding_before, (
            'Re-acknowledging a history-padding repeat must remain local UI state.'
        )
        padding_before_predicate_ids = page.evaluate("""async expected => {
          const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
          if (!response.ok) throw new Error('Pre-repeat predicate history read failed: ' + response.status);
          const dto = await response.json();
          return dto.world.events.filter(event =>
            event?.type === 'source-archive-predicate-evaluated' &&
            event.actor?.id === expected.actorId && event.actor?.role === expected.actorRole &&
            event.creationId === expected.creationId && event.version === expected.version &&
            event.predicateKind === 'contains-literal' && event.literal === expected.literal &&
            event.outcome === 'MATCH'
          ).map(event => event.id);
        }""", {
            'actorId': actor['viewerId'], 'actorRole': role,
            'creationId': archive['creationId'], 'version': archive['version'],
            'literal': predicate_literal
        })
        padding_submit.evaluate("""button => {
          window.__sourcePredicateSubmitLockObserved = false;
          const observer = new MutationObserver(() => {
            if (button.disabled) {
              window.__sourcePredicateSubmitLockObserved = true;
              observer.disconnect();
            }
          });
          observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
        }""")
        padding_submit.tap()
        padding_query = {
            'beforeEventIds': padding_before['eventIds'],
            'literal': predicate_literal
        }
        # Wait for the renderer to expose a newly retained card, then read the
        # authoritative API snapshot below. This avoids treating an unresolved
        # fetch Promise as a successful wait condition.
        page.wait_for_function(
            """expected => Array.from(document.querySelectorAll(
              '#sheet-content [data-source-predicate-event-id]'
            )).some(card => {
              const eventId = card.getAttribute('data-source-predicate-event-id');
              return eventId && !expected.beforeEventIds.includes(eventId) &&
                card.textContent.includes(expected.literal) &&
                card.textContent.includes('Source predicate · MATCH');
            })""",
            arg=padding_query,
            timeout=15000
        )
        padding_after_predicate_ids = page.evaluate("""async expected => {
          const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
          if (!response.ok) throw new Error('Post-repeat predicate history read failed: ' + response.status);
          const dto = await response.json();
          return dto.world.events.filter(event =>
            event?.type === 'source-archive-predicate-evaluated' &&
            event.actor?.id === expected.actorId && event.actor?.role === expected.actorRole &&
            event.creationId === expected.creationId && event.version === expected.version &&
            event.predicateKind === 'contains-literal' && event.literal === expected.literal &&
            event.outcome === 'MATCH'
          ).map(event => event.id);
        }""", {
            'actorId': actor['viewerId'], 'actorRole': role,
            'creationId': archive['creationId'], 'version': archive['version'],
            'literal': predicate_literal
        })
        assert len(padding_after_predicate_ids) == len(padding_before_predicate_ids) + 1, (
            'One explicit repeat must append exactly one new actor/source/operator predicate event; '
            f'actor={actor["viewerId"]}/{role}, before={padding_before_predicate_ids}, '
            f'after={padding_after_predicate_ids}'
        )
        assert padding_after_predicate_ids[:-1] == padding_before_predicate_ids, (
            'A repeat must preserve prior event order and append only one new event.'
        )
        submit_lock_observed = page.evaluate(
            "() => window.__sourcePredicateSubmitLockObserved === true"
        )
        assert submit_lock_observed, (
            'The mobile predicate submit control must disable while its shared action is in flight.'
        )
        source_analyst_submit_lock_observed = (
            source_analyst_submit_lock_observed and submit_lock_observed
        )
        padding_event_id = padding_after_predicate_ids[-1]
        assert padding_event_id not in padding_before_predicate_ids
        padding_after = authoritative_snapshot(page)
        assert padding_event_id in padding_after['eventIds'], (
            'The new predicate event must be present in the authoritative world snapshot.'
        )
        assert padding_after['xp'] == padding_before['xp'], (
            'Same-outcome history-padding repeats must never award XP.'
        )
        page.wait_for_function(
            """expected => Array.from(document.querySelectorAll(
              '#sheet-content [data-source-predicate-event-id]'
            )).some(card => card.getAttribute('data-source-predicate-event-id') === expected)""",
            arg=padding_event_id,
            timeout=10000
        )
        padding_status = page.locator(
            '#sheet-content [data-source-analyst-contrast-status="true"]'
        )
        expect(padding_status).to_have_count(1)
        expect(padding_status).to_have_attribute('data-source-analyst-progress', '2/2')
        history_padding_event_ids.append(padding_event_id)

    assert len(history_padding_event_ids) == history_padding_repeats
    assert len(set(history_padding_event_ids)) == history_padding_repeats
    padding_history_state = page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Padded predicate history read failed: ' + response.status);
      const dto = await response.json();
      const all = dto.world.events.filter(event =>
        event?.type === 'source-archive-predicate-evaluated'
      ).map(event => event.id);
      const actor = dto.world.events.filter(event =>
        event?.type === 'source-archive-predicate-evaluated' &&
        event.actor?.id === expected.actorId && event.actor?.role === expected.actorRole &&
        event.creationId === expected.creationId && event.version === expected.version &&
        event.literal === expected.literal
      ).map(event => event.id);
      return { allEventIds: all, actorEventIds: actor };
    }""", {
        'actorId': actor['viewerId'], 'actorRole': role,
        'creationId': archive['creationId'], 'version': archive['version'],
        'literal': predicate_literal
    })
    assert len(padding_history_state['actorEventIds']) == 3 + history_padding_repeats, (
        'The actor history must retain the original two-operator pair, its earlier repeat, and every padding repeat.'
    )
    assert padding_history_state['actorEventIds'][-history_padding_repeats:] == history_padding_event_ids
    recent_predicate_event_ids = set(padding_history_state['allEventIds'][-12:])
    old_history_outside_recent_window = all(
        event_id not in recent_predicate_event_ids for event_id in contrast_event_ids
    )
    assert old_history_outside_recent_window, (
        'Both counted contrast events must be older than the renderer’s 12-event recent-history window.'
    )

    page.locator('#sheet-close').tap()
    padded_source_analyst_baseline = authoritative_snapshot(page)
    padded_source_analyst = open_source_analyst_workbench(
        page, padded_source_analyst_baseline, '2/2'
    )
    padded_status = page.locator(
        '#sheet-content [data-source-analyst-contrast-status="true"]'
    )
    padded_results = padded_status.locator('[data-source-analyst-result-event-id]')
    expect(padded_results).to_have_count(2)
    padded_event_ids = [
        padded_results.nth(index).get_attribute('data-source-analyst-result-event-id')
        for index in range(2)
    ]
    assert padded_event_ids == contrast_event_ids, (
        'The Source Analyst must pin the exact counted event pair after both events leave recent history.'
    )
    rendered_history_event_ids = page.locator(
        '#sheet-content [data-source-predicate-event-id]'
    ).evaluate_all(
        "(cards) => cards.map(card => card.getAttribute('data-source-predicate-event-id'))"
    )
    expected_visible_history_ids = set(
        padding_history_state['allEventIds'][-12:] + contrast_event_ids
    )
    assert len(rendered_history_event_ids) == len(expected_visible_history_ids)
    assert set(rendered_history_event_ids) == expected_visible_history_ids, (
        'The history view must show the latest 12 predicate events plus the exact objective evidence IDs, without duplicates.'
    )
    old_history_inspection_read_only = True
    for event_id in contrast_event_ids:
        inspect_old_event = padded_status.locator(
            '[data-source-analyst-inspect-event="' + event_id + '"]'
        )
        expect(inspect_old_event).to_have_count(1)
        before_old_inspection = authoritative_snapshot(page)
        inspect_old_event.tap()
        page.wait_for_function(
            """expected => document.activeElement?.getAttribute('data-source-predicate-event-id') === expected""",
            arg=event_id
        )
        after_old_inspection = authoritative_snapshot(page)
        if after_old_inspection != before_old_inspection:
            old_history_inspection_read_only = False
        assert after_old_inspection == before_old_inspection, (
            'Inspecting a pinned older predicate event must not append events, change XP, or mutate the world.'
        )
    padded_history_screenshot = out / ('source-analyst-pinned-history-' + role + '-' + suffix + '.png')
    page.screenshot(path=str(padded_history_screenshot), full_page=True)

    page.locator('#sheet-close').tap()
    open_quest_board(page)
    final_board_before = authoritative_snapshot(page)
    assert_board(page, role)
    assert_source_archive_objectives(page, role, '1/1', '1/1', '1/1', '2/2')
    final_board_after = authoritative_snapshot(page)
    assert final_board_after == final_board_before, (
        'Reading the recorded Source Archive objectives must not append events or award XP.'
    )
    assert final_board_after['xp'] == chain_start['xp'], (
        'Source Archive proposal/report/predicate activity must not award XP.'
    )
    screenshot = out / ('source-archive-quest-' + role + '-' + suffix + '.png')
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        'actorRole': role,
        'actorId': actor['viewerId'],
        'archiveCreationId': archive['creationId'],
        'archiveVersion': archive['version'],
        'sourceRetrieval': archive['sourceRetrieval'],
        'sourceTransport': archive['sourceTransport'],
        'independentVerification': 'NOT_PERFORMED',
        'proposalEventId': research_details['proposalEventId'],
        'reportEventId': research_details['reportEventId'],
        'reportOutcome': research_details['reportOutcome'],
        'proposalProgress': '1/1',
        'experimentProgress': '1/1',
        'xpBefore': chain_start['xp'],
        'xpAfter': final_board_after['xp'],
        'xpUnchanged': final_board_after['xp'] == chain_start['xp'],
        'proposalActionAppendedOneEvent': proposal_after['revision'] == proposal_before['revision'] + 1,
        'reportActionAppendedOneEvent': report_after['revision'] == report_before['revision'] + 1,
        'sourceAnalystNpcId': 'local-npc-source-analyst',
        'sourceAnalystHiddenUntilTalk': source_analyst_hidden_until_talk,
        'sourceAnalystPredicateRouteReadOnly': predicate_source_analyst['routeReadOnly'],
        'sourceAnalystPredicateTalkReadOnly': predicate_source_analyst['talkReadOnly'],
        'sourceAnalystContrastRouteReadOnly': contrast_source_analyst['routeReadOnly'],
        'sourceAnalystContrastTalkReadOnly': (
            contrast_source_analyst['talkReadOnly'] and
            complete_source_analyst['talkReadOnly'] and
            padded_source_analyst['talkReadOnly']
        ),
        'sourceAnalystHistoryPaddingProgressDeduplicated': (
            padded_source_analyst['contrastProgress'] == '2/2' and
            padded_source_analyst['contrastStatus'] == 'complete'
        ),
        'sourceAnalystHistoryPaddingXpUnchanged': final_board_after['xp'] == chain_start['xp'],
        'sourceAnalystSubmitLockedDuringWrite': source_analyst_submit_lock_observed,
        'sourceAnalystProgressAfterFirstSubmit': first_progress_value,
        'sourceAnalystProgressAfterContrastSubmit': completed_progress_value,
        'sourceAnalystContrastProgressAfterTalk': complete_source_analyst['contrastProgress'],
        'sourceAnalystContrastStatusAfterTalk': complete_source_analyst['contrastStatus'],
        'sourceAnalystContrastEventIds': contrast_event_ids,
        'sourceAnalystContrastScreenshot': analyst_screenshot.name,
        'sourceAnalystExactHistoryInspectionReadOnly': contrast_history_inspection_read_only,
        'sourceAnalystHistoryPaddingRepeats': len(history_padding_event_ids),
        'sourceAnalystOldHistoryOutsideRecentWindow': old_history_outside_recent_window,
        'sourceAnalystPinnedHistoryEventIds': contrast_event_ids,
        'sourceAnalystRenderedHistoryCardCount': len(rendered_history_event_ids),
        'sourceAnalystOldHistoryInspectionReadOnly': old_history_inspection_read_only,
        'sourceAnalystPinnedHistoryScreenshot': padded_history_screenshot.name,
        'sourceAnalystCardFocused': (
            predicate_source_analyst['cardFocused'] and
            contrast_source_analyst['cardFocused'] and
            complete_source_analyst['cardFocused'] and padded_source_analyst['cardFocused']
        ),
        'sourceAnalystNoModelCall': (
            predicate_source_analyst['noModelCall'] and
            contrast_source_analyst['noModelCall'] and
            complete_source_analyst['noModelCall'] and padded_source_analyst['noModelCall']
        ),
        'sourceAnalystWorkbenchVisible': (
            predicate_source_analyst['workbenchVisible'] and
            contrast_source_analyst['workbenchVisible'] and
            complete_source_analyst['workbenchVisible'] and padded_source_analyst['workbenchVisible']
        ),
        'predicateEventId': predicate_details['eventId'],
        'predicateOutcome': predicate_details['outcome'],
        'predicateProgress': '1/1',
        'predicateRepeatEventIds': repeat_details['eventIds'],
        'predicateRepeatOutcomes': repeat_details['outcomes'],
        'predicateRepeatPrefillReadOnly': repeat_prefill == repeat_before,
        'contrastBoardPartialProgress': '1/2',
        'contrastPredicateEventId': contrast_details['eventId'],
        'contrastPredicateKind': contrast_details['predicateKind'],
        'contrastPredicateLiteral': contrast_details['literal'],
        'contrastPredicateOutcome': contrast_details['outcome'],
        'contrastPredicateProgress': '2/2',
        'contrastPredicateSameSourceVersion': (
            contrast_details['creationId'] == archive['creationId'] and
            contrast_details['version'] == archive['version'] and
            contrast_details['sourceSha256'] == predicate_details['sourceSha256']
        ),
        'contrastPredicateXpUnchanged': contrast_after['xp'] == contrast_before['xp'],
        'predicateRepeatAcknowledgementReset': repeat_acknowledgement_was_reset,
        'predicateRepeatActionAppendedOneEvent': predicate_after_repeat['revision'] == predicate_after['revision'] + 1,
        'predicateRepeatXpUnchanged': predicate_after_repeat['xp'] == predicate_after['xp'],
        'predicateRepeatProgressDeduplicated': '1/1',
        'predicateActionAppendedOneEvent': predicate_after['revision'] == predicate_before['revision'] + 1,
        'predicateSourceTruth': predicate_details['sourceTruth'],
        'predicateIndependentVerification': predicate_details['independentVerification'],
        'predicateModelAssertions': predicate_details['modelAssertions'],
        'predicateAcknowledgementVersion': predicate_details['publicRetentionAcknowledgementVersion'],
        'predicateXpUnchanged': predicate_after['xp'] == predicate_before['xp'],
        'boardInspectionReadOnly': True,
        'failureRemainsSelfReported': True,
        'publicRetentionDisclosureVisible': True,
        'publicRetentionAcknowledgementRequired': True,
        'unacknowledgedSubmissionBlocked': unacknowledged_submission_blocked,
        'acknowledgementDidNotMutateWorld': acknowledgement_did_not_mutate_world,
        'screenshot': screenshot.name
    }


def verify_founder_source_archive_progress(browser, url, out, expected_actor_id, archive):
    context = browser.new_context(
        viewport={'width': 390, 'height': 844},
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
        page.locator('#login-button').tap()
        page.locator('#founder-name').fill('Damien')
        page.locator('#founder-key').fill('fake-browser-fixture-key-not-a-secret')
        page.locator('#verify-founder').tap()
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
        before = authoritative_snapshot(page)
        assert before['viewerId'] == expected_actor_id, (
            'A fresh Founder client must resolve to the same pseudonymous Founder actor.'
        )
        open_quest_board(page)
        assert_board(page, 'founder')
        assert_source_archive_objectives(page, 'founder', '1/1', '1/1', '1/1', '2/2')
        after = authoritative_snapshot(page)
        assert after == before, 'A fresh Founder Quest Board inspection must remain read-only.'
        details = source_archive_research_snapshot(
            page, expected_actor_id, 'founder', archive,
            'Source Archive workflow · Founder', True
        )
        assert not errors, 'Fresh Founder browser page errors: ' + json.dumps(errors)
        screenshot = out / 'source-archive-founder-fresh-client-390.png'
        page.screenshot(path=str(screenshot), full_page=True)
        return {
            'viewerRole': 'founder',
            'actorId': before['viewerId'],
            'founderObjectivesRemainActorScoped': True,
            'proposalProgress': '1/1',
            'experimentProgress': '1/1',
            'sharedArchiveCreationId': archive['creationId'],
            'worldStateUnchanged': True,
            'pageErrors': errors,
            'screenshot': screenshot.name,
            'proposalEventId': details['proposalEventId'],
            'reportEventId': details['reportEventId']
        }
    finally:
        context.close()




def evidence_archive_activity_collection_ids(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Evidence Archive activity state read failed: ' + response.status);
      const dto = await response.json();
      const world = dto?.world;
      if (!Array.isArray(world?.reports) || !Array.isArray(world?.contributions)) {
        throw new Error('The actor-visible report and contribution collections are unavailable.');
      }
      if (!Array.isArray(world.events)) {
        throw new Error('The retained world event history is unavailable; source links cannot be checked.');
      }
      const ids = values => values.map(item => item?.id);
      const result = { reports: ids(world.reports), contributions: ids(world.contributions), sourceEvents: {} };
      for (const [name, values] of Object.entries({ reports: result.reports, contributions: result.contributions })) {
        if (values.some(id => typeof id !== 'string' || !id)) {
          throw new Error('The retained ' + name + ' collection contains an unidentified record.');
        }
      }
      world.events.forEach((event, index) => {
        const recordId = event?.actionResult?.id;
        if (typeof recordId !== 'string' || !recordId) return;
        if (!result.sourceEvents[recordId]) result.sourceEvents[recordId] = [];
        result.sourceEvents[recordId].push({
          eventId: event.id,
          eventPosition: index + 1,
          type: event.type,
          creationId: event.creationId,
          version: event.version,
          actorId: event.actor?.id,
          actorRole: event.actor?.role,
          actorName: event.actor?.name
        });
      });
      return result;
    }""")


def assert_evidence_archive_activity_streams_mobile(page, out, width, errors, browser, url):
    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').tap()
    baseline = authoritative_snapshot(page)
    baseline_streams = evidence_archive_activity_collection_ids(page)
    assert baseline['creationVersions'], 'A published artifact is required for report/contribution stream fixtures.'
    creation_id, version = baseline['creationVersions'][-1]
    report_ids = []
    contribution_ids = []
    for index in range(2):
        report = post_action(page, {
            'type': 'report',
            'creationId': creation_id,
            'version': version,
            'text': f'Actor-authored report {width}-{index + 1}; retained claim, not verified truth.',
            'requestId': f'quest-board-evidence-report-{width}-{index + 1}'
        })
        report_id = report.get('result', {}).get('id')
        assert isinstance(report_id, str) and report_id, 'The server must return each retained report ID.'
        report_ids.append(report_id)
        contribution = post_action(page, {
            'type': 'contribute',
            'creationId': creation_id,
            'version': version,
            'text': f'Actor-authored contribution {width}-{index + 1}; retained activity, not evidence certification.',
            'requestId': f'quest-board-evidence-contribution-{width}-{index + 1}'
        })
        contribution_id = contribution.get('result', {}).get('id')
        assert isinstance(contribution_id, str) and contribution_id, 'The server must return each retained contribution ID.'
        contribution_ids.append(contribution_id)

    after_actions = authoritative_snapshot(page)
    after_streams = evidence_archive_activity_collection_ids(page)
    assert after_actions['revision'] == baseline['revision'] + 4, (
        'Two reports and two contributions must append exactly four world events.'
    )
    assert after_actions['xp'] == baseline['xp'], (
        'Self-reported archive activity must not manufacture XP.'
    )
    assert after_streams['reports'] == baseline_streams['reports'] + report_ids, (
        'The report collection must append only the two exact server-returned report IDs.'
    )
    assert after_streams['contributions'] == baseline_streams['contributions'] + contribution_ids, (
        'The contribution collection must append only the two exact server-returned contribution IDs.'
    )
    page.wait_for_function(
        "expected => Number(document.querySelector('#world')?.dataset.worldRevision) >= expected",
        arg=after_actions['revision']
    )
    open_evidence_archive(page)
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    inspection_before = authoritative_snapshot(page)

    report_stream = page.locator('#sheet-content [data-evidence-archive-activity-stream="report"]')
    contribution_stream = page.locator('#sheet-content [data-evidence-archive-activity-stream="contribution"]')
    expect(report_stream).to_have_count(1)
    expect(contribution_stream).to_have_count(1)
    for stream, count in (
        (report_stream, len(after_streams['reports'])),
        (contribution_stream, len(after_streams['contributions']))
    ):
        expect(stream).to_have_attribute('data-stream-status', 'available')
        expect(stream).to_have_attribute('data-ordering-basis', 'retained-append-position')
        expect(stream).to_have_attribute('data-stream-scope', 'actor-visible-collection')
        expect(stream).to_have_attribute('data-stream-count', str(count))

    report_cards = report_stream.locator('[data-evidence-archive-activity-record="report"]')
    contribution_cards = contribution_stream.locator('[data-evidence-archive-activity-record="contribution"]')
    expect(report_cards).to_have_count(len(after_streams['reports']))
    expect(contribution_cards).to_have_count(len(after_streams['contributions']))
    report_display_ids = report_cards.evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-activity-record-id'))"
    )
    contribution_display_ids = contribution_cards.evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-activity-record-id'))"
    )
    report_positions = report_cards.evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-stream-position'))"
    )
    contribution_positions = contribution_cards.evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-stream-position'))"
    )
    assert report_display_ids == list(reversed(after_streams['reports'])), (
        'Report cards must preserve actor-visible append order, newest first.'
    )
    assert contribution_display_ids == list(reversed(after_streams['contributions'])), (
        'Contribution cards must preserve actor-visible append order, newest first.'
    )
    assert report_display_ids[:2] == list(reversed(report_ids))
    assert contribution_display_ids[:2] == list(reversed(contribution_ids))
    assert report_positions == [str(position) for position in range(len(after_streams['reports']), 0, -1)]
    assert contribution_positions == [str(position) for position in range(len(after_streams['contributions']), 0, -1)]
    expect(report_cards.first).to_have_attribute('data-record-status', 'linked')
    expect(contribution_cards.first).to_have_attribute('data-record-status', 'linked')
    expect(report_cards.first).to_contain_text('Retained self-reported activity')
    expect(contribution_cards.first).to_contain_text('Retained self-reported activity')

    legacy_activity_headings = page.locator('#sheet-content h3').evaluate_all(
        "nodes => nodes.filter(node => /^(Report|Contribution) ·/.test((node.textContent || '').trim()) && !node.closest('[data-evidence-archive-activity-stream]')).map(node => (node.textContent || '').trim())"
    )
    assert not legacy_activity_headings, (
        'Evidence Archive must not duplicate these records in the legacy timestamp-sorted list: ' +
        json.dumps(legacy_activity_headings)
    )

    target_record_id = report_ids[-1] if width == 320 else contribution_ids[-1]
    target_record_type = 'report' if width == 320 else 'contribution'
    expected_event_type = 'report' if width == 320 else 'contribute'
    source_matches = after_streams['sourceEvents'].get(target_record_id, [])
    assert len(source_matches) == 1, (
        'The server-retained actionResult.id must identify exactly one source event for ' +
        target_record_type + ': ' + json.dumps(source_matches)
    )
    source_event = source_matches[0]
    assert source_event['type'] == expected_event_type
    assert source_event['creationId'] == creation_id
    assert source_event['version'] == version
    assert source_event['actorId'] == after_actions['viewerId']
    assert source_event['actorRole'] == after_actions['viewerRole']
    assert isinstance(source_event['actorName'], str) and source_event['actorName']

    target_card = page.locator(
        '#sheet-content [data-activity-record-id="' + target_record_id + '"]'
    )
    expect(target_card).to_have_attribute('data-record-status', 'linked')
    expect(target_card).to_have_attribute('data-activity-actor-id', after_actions['viewerId'])
    expect(target_card).to_have_attribute('data-activity-actor-role', after_actions['viewerRole'])
    source_link = target_card.locator('[data-evidence-archive-open-event="true"]')
    expect(source_link).to_have_count(1)
    expect(source_link).to_have_attribute('data-event-id', source_event['eventId'])
    expect(source_link).to_have_attribute('data-event-position', str(source_event['eventPosition']))
    expect(source_link).to_have_attribute('data-event-type', expected_event_type)
    expect(target_card).to_contain_text('does not verify the claim')
    # A second browser context enters as a distinct pseudonymous Witness actor.
    # It appends one report while the Founder keeps an older Archive snapshot open.
    # Distinct actor IDs establish separate session actors, not distinct human beings.
    second_context = browser.new_context(
        viewport={'width': width, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    second_page = second_context.new_page()
    second_errors = []
    second_page.on('pageerror', lambda error: second_errors.append(str(error)))
    try:
        second_page.goto(url, wait_until='networkidle')
        second_page.locator('#start-shared').tap()
        second_page.locator('#world').wait_for(state='visible')
        second_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        second_before = authoritative_snapshot(second_page)
        assert second_before['viewerRole'] == 'witness'
        assert second_before['viewerId'] != after_actions['viewerId']
        assert after_actions['viewerRole'] == 'founder'
        assert second_before['revision'] == after_actions['revision']
        second_report = post_action(second_page, {
            'type': 'report',
            'creationId': creation_id,
            'version': version,
            'text': 'Witness-authored report while the Founder keeps an older Archive snapshot open; retained activity, not verified truth.',
            'requestId': 'quest-board-evidence-offline-refresh-' + str(width)
        })
        new_report_id = second_report.get('result', {}).get('id')
        assert isinstance(new_report_id, str) and new_report_id, (
            'The connected second session must return the exact retained report ID.'
        )
        second_after = authoritative_snapshot(second_page)
        assert second_after['viewerId'] == second_before['viewerId']
        assert second_after['viewerRole'] == 'witness'
        assert second_after['revision'] == second_before['revision'] + 1, (
            'The second-session report must append exactly one shared-world event.'
        )
        assert second_after['xp'] == second_before['xp'], (
            'A second-session report must not manufacture XP.'
        )
        second_streams = evidence_archive_activity_collection_ids(second_page)
        new_report_events = second_streams['sourceEvents'].get(new_report_id, [])
        assert len(new_report_events) == 1, (
            'The second-session report must identify exactly one retained source event.'
        )
        new_report_event_id = new_report_events[0]['eventId']
        assert new_report_events[0]['type'] == 'report'
        assert new_report_events[0]['creationId'] == creation_id
        assert new_report_events[0]['version'] == version
        assert new_report_events[0]['actorId'] == second_before['viewerId']
        assert new_report_events[0]['actorRole'] == 'witness'
        assert new_report_event_id not in second_before['eventIds'], (
            'The second-session report event must be new to the connected session.'
        )
    finally:
        second_context.close()
    assert not second_errors, (
        'Second-session page errors during offline snapshot recovery: ' + json.dumps(second_errors)
    )

    assert new_report_event_id not in inspection_before['eventIds'], (
        'The second-session report event must be newer than the Archive snapshot already open.'
    )
    page.wait_for_function(
        "expected => Number(document.querySelector('#world')?.dataset.worldRevision) >= expected",
        arg=second_after['revision'],
        timeout=30000
    )
    accepted_revision_while_connected = int(
        page.locator('#world').get_attribute('data-world-revision')
    )
    assert accepted_revision_while_connected == second_after['revision'], (
        'The first session must accept the second-session report before disconnecting.'
    )
    assert page.locator('#sheet-content').get_attribute(
        'data-evidence-archive-snapshot-revision'
    ) == str(inspection_before['revision']), (
        'The open Evidence Archive must remain pinned after the live world accepts a newer revision.'
    )
    assert page.locator(
        '#sheet-content [data-activity-record-id="' + new_report_id + '"]'
    ).count() == 0, 'The newer report must not leak into the older Archive snapshot.'

    offline_api_requests = []
    origin = page.evaluate("() => location.origin")

    def capture_offline_api_request(request):
        if request.url.startswith(origin + '/api/'):
            offline_api_requests.append({
                'method': request.method,
                'path': request.url.split('?', 1)[0][len(origin):]
            })

    page.on('request', capture_offline_api_request)
    page.context.set_offline(True)
    page.wait_for_function(
        "() => document.querySelector('#connection-dot')?.dataset.connectionState === 'offline'"
    )
    expect(page.locator('#sheet-content [data-evidence-archive-snapshot-freshness="stale"]')).to_have_attribute(
        'data-current-revision', str(second_after['revision'])
    )
    stale_notice = page.locator(
        '#sheet-content [data-evidence-archive-snapshot-freshness="stale"]'
    )
    expect(stale_notice).to_have_count(1)
    expect(stale_notice).to_have_attribute(
        'data-snapshot-revision', str(inspection_before['revision'])
    )
    assert page.locator('#sheet-content').get_attribute(
        'data-evidence-archive-snapshot-revision'
    ) == str(inspection_before['revision'])
    page.screenshot(
        path=str(out / ('evidence-archive-offline-stale-' + str(width) + '.png')),
        full_page=True
    )

    source_link.tap()
    expect(page.locator('#sheet-title')).to_have_text('World Chronicle')
    chronicle_freshness = page.locator(
        '#sheet-content [data-chronicle-snapshot-freshness]'
    )
    expect(chronicle_freshness).to_have_attribute(
        'data-chronicle-snapshot-freshness', 'stale'
    )
    expect(page.locator('#sheet-content')).to_have_attribute(
        'data-chronicle-snapshot-freshness-reason', 'disconnected'
    )
    expect(chronicle_freshness).to_contain_text(
        'The shared stream is disconnected'
    )
    expect(page.locator(
        '#sheet-content [data-event-id="world:' + source_event['eventId'] + '"]'
    )).to_have_count(1)
    chronicle_search = page.locator('#sheet-content [data-chronicle-search="true"]')
    expect(chronicle_search).to_have_value(source_event['eventId'])
    assert page.locator('#sheet-content').get_attribute(
        'data-chronicle-snapshot-revision'
    ) == str(inspection_before['revision']), (
        'Offline Chronicle navigation must use the exact snapshot from the Archive card, not a newer global world object.'
    )
    return_button = page.locator(
        '#sheet-content [data-chronicle-return-evidence-archive="true"]'
    )
    expect(return_button).to_have_count(1)
    page.screenshot(
        path=str(out / ('evidence-archive-chronicle-offline-' + str(width) + '.png')),
        full_page=True
    )
    return_button.tap()
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    stale_notice = page.locator(
        '#sheet-content [data-evidence-archive-snapshot-freshness="stale"]'
    )
    expect(stale_notice).to_have_count(1)
    assert page.locator('#sheet-content').get_attribute(
        'data-evidence-archive-snapshot-revision'
    ) == str(inspection_before['revision'])

    assert page.locator(
        '#sheet-content [data-activity-record-id="' + new_report_id + '"]'
    ).count() == 0, 'Returning offline must preserve the Archive snapshot rather than adopt the newer global world.'


    offline_api_mutations = [
        request for request in offline_api_requests
        if request['method'] != 'GET' or request['path'] in (
            '/api/state', '/api/action', '/api/presence', '/api/position'
        )
    ]
    assert not offline_api_mutations, (
        'Offline Evidence Archive/Chronicle inspection must not issue shared state, action, presence, position, or write requests: ' +
        json.dumps(offline_api_mutations)
    )
    accepted_revision_while_offline = int(
        page.locator('#world').get_attribute('data-world-revision')
    )
    assert inspection_before['revision'] <= accepted_revision_while_offline <= second_after['revision'], (
        'The live projection may accept an already-in-flight stream event, but it cannot exceed the connected second-session snapshot.'
    )
    assert page.locator('#sheet-content').get_attribute(
        'data-evidence-archive-snapshot-revision'
    ) == str(inspection_before['revision']), (
        'The open Evidence Archive must remain pinned to its opening snapshot while the connection is offline.'
    )
    expect(stale_notice).to_have_attribute(
        'data-current-revision', str(accepted_revision_while_offline)
    )

    page.context.set_offline(False)
    page.wait_for_function(
        "expected => document.querySelector('#connection-dot')?.dataset.connectionState === 'online' && Number(document.querySelector('#world')?.dataset.worldRevision) >= expected",
        arg=second_after['revision'],
        timeout=30000
    )
    refresh_notice = page.locator(
        '#sheet-content [data-evidence-archive-snapshot-freshness="refresh-required"]'
    )
    expect(refresh_notice).to_have_count(1)
    expect(refresh_notice).to_have_attribute(
        'data-snapshot-revision', str(inspection_before['revision'])
    )
    expect(refresh_notice).to_have_attribute(
        'data-current-revision', str(second_after['revision'])
    )
    refresh_button = refresh_notice.locator(
        '[data-evidence-archive-refresh="true"]'
    )
    expect(refresh_button).to_be_enabled()
    page.screenshot(
        path=str(out / ('evidence-archive-reconnect-refresh-required-' + str(width) + '.png')),
        full_page=True
    )
    refresh_button.tap()
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    expect(page.locator(
        '#sheet-content [data-evidence-archive-snapshot-freshness]'
    )).to_have_count(0)
    page.wait_for_function(
        "expected => document.querySelector('#sheet-content')?.dataset.evidenceArchiveSnapshotRevision === String(expected)",
        arg=second_after['revision']
    )
    refreshed_state = authoritative_snapshot(page)
    shared_world_keys = ('revision', 'mutuallyVisibleEventIds', 'creationVersions')
    refreshed_shared_world = {
        key: refreshed_state[key] for key in shared_world_keys
    }
    witness_shared_world = {
        key: second_after[key] for key in shared_world_keys
    }
    assert refreshed_shared_world == witness_shared_world, (
        'Refreshing the Evidence Archive must load the same common world projection as the Witness client.'
    )
    assert refreshed_state['viewerId'] == after_actions['viewerId']
    assert refreshed_state['viewerRole'] == 'founder'
    assert refreshed_state['xp'] == inspection_before['xp'], (
        'Archive refresh must not award Founder XP.'
    )
    assert second_after['xp'] == second_before['xp'], (
        'The Witness report must not award Witness XP.'
    )
    assert new_report_event_id in refreshed_state['mutuallyVisibleEventIds']
    assert new_report_event_id in second_after['mutuallyVisibleEventIds']
    new_report_card = page.locator(
        '#sheet-content [data-activity-record-id="' + new_report_id + '"]'
    )
    expect(new_report_card).to_have_count(1)
    expect(new_report_card).to_have_attribute('data-activity-actor-id', second_before['viewerId'])
    expect(new_report_card).to_have_attribute('data-activity-actor-role', 'witness')
    expect(new_report_card).to_contain_text('Recorded actor role: witness')
    expect(new_report_card).to_contain_text('pseudonymous session attribution')
    expect(new_report_card).to_have_attribute('data-record-status', 'linked')
    witness_source_link = new_report_card.locator('[data-evidence-archive-open-event="true"]')
    expect(witness_source_link).to_have_count(1)
    expect(witness_source_link).to_have_attribute('data-event-id', new_report_event_id)
    witness_source_position = witness_source_link.get_attribute('data-event-position')
    assert witness_source_position and witness_source_position.isdigit(), (
        'The Archive must disclose its own retained source-event append position.'
    )
    witness_source_link.tap()
    expect(page.locator('#sheet-title')).to_have_text('World Chronicle')
    witness_chronicle_card = page.locator(
        '#sheet-content [data-event-id="world:' + new_report_event_id + '"]'
    )
    expect(witness_chronicle_card).to_have_count(1)
    expect(witness_chronicle_card).to_have_attribute(
        'data-chronicle-actor-id', second_before['viewerId']
    )
    expect(witness_chronicle_card).to_have_attribute('data-chronicle-actor-role', 'witness')
    expect(witness_chronicle_card).to_have_attribute(
        'data-chronicle-actor-attribution', 'complete'
    )
    expect(witness_chronicle_card).to_have_attribute(
        'data-stream-position', witness_source_position
    )
    expect(witness_chronicle_card).to_contain_text('Recorded actor role: witness')
    expect(witness_chronicle_card).to_contain_text(
        'pseudonymous session attribution; not proof of a distinct human'
    )
    expect(page.locator('#sheet-content')).to_have_attribute(
        'data-chronicle-snapshot-revision', str(refreshed_state['revision'])
    )
    witness_chronicle_state = authoritative_snapshot(page)
    assert witness_chronicle_state == refreshed_state, (
        'Opening the Witness report source event must not mutate shared world state or XP.'
    )
    witness_return_button = page.locator(
        '#sheet-content [data-chronicle-return-evidence-archive="true"]'
    )
    expect(witness_return_button).to_have_count(1)
    witness_return_button.tap()
    expect(page.locator('#sheet-title')).to_have_text('Evidence Archive')
    returned_witness_card = page.locator(
        '#sheet-content [data-activity-record-id="' + new_report_id + '"]'
    )
    expect(returned_witness_card).to_have_count(1)
    expect(returned_witness_card).to_have_attribute(
        'data-activity-actor-id', second_before['viewerId']
    )
    expect(returned_witness_card).to_have_attribute('data-activity-actor-role', 'witness')
    assert authoritative_snapshot(page) == refreshed_state, (
        'Returning from the Witness Chronicle event must preserve the accepted Archive snapshot.'
    )
    report_stream = page.locator(
        '#sheet-content [data-evidence-archive-activity-stream="report"]'
    )
    contribution_stream = page.locator(
        '#sheet-content [data-evidence-archive-activity-stream="contribution"]'
    )
    expect(report_stream).to_have_attribute(
        'data-stream-count', str(len(after_streams['reports']) + 1)
    )
    report_cards = report_stream.locator(
        '[data-evidence-archive-activity-record="report"]'
    )
    contribution_cards = contribution_stream.locator(
        '[data-evidence-archive-activity-record="contribution"]'
    )
    expect(report_cards.first).to_have_attribute(
        'data-activity-record-id', new_report_id
    )
    expect(report_cards.first).to_have_attribute(
        'data-stream-position', str(len(after_streams['reports']) + 1)
    )
    page.screenshot(
        path=str(out / ('evidence-archive-reconnected-' + str(width) + '.png')),
        full_page=True
    )

    target_card = page.locator(
        '#sheet-content [data-activity-record-id="' + target_record_id + '"]'
    )
    expect(target_card).to_have_attribute('data-record-status', 'linked')
    expect(target_card).to_have_attribute('data-activity-actor-id', after_actions['viewerId'])
    expect(target_card).to_have_attribute('data-activity-actor-role', after_actions['viewerRole'])
    source_link = target_card.locator('[data-evidence-archive-open-event="true"]')
    expect(source_link).to_have_count(1)
    expect(source_link).to_have_attribute('data-event-id', source_event['eventId'])
    source_link.tap()
    expect(page.locator('#sheet-title')).to_have_text('World Chronicle')
    expect(page.locator(
        '#sheet-content [data-chronicle-snapshot-freshness="current"]'
    )).to_have_count(1)
    expect(page.locator(
        '#sheet-content [data-event-id="world:' + source_event['eventId'] + '"]'
    )).to_have_count(1)
    chronicle_search = page.locator('#sheet-content [data-chronicle-search="true"]')
    expect(chronicle_search).to_have_value(source_event['eventId'])
    after_chronicle_inspection = authoritative_snapshot(page)
    assert after_chronicle_inspection == refreshed_state, (
        'Reopening the same source event after reconnect must remain read-only.'
    )
    assert after_chronicle_inspection['xp'] == refreshed_state['xp']
    return_button = page.locator(
        '#sheet-content [data-chronicle-return-evidence-archive="true"]'
    )
    expect(return_button).to_have_count(1)
    chronicle_route_before = authoritative_snapshot(page)
    town_square_route = page.locator(
        '#sheet-content [data-chronicle-institution-route="town-square"]'
    )
    expect(town_square_route).to_have_count(1)
    expect(town_square_route).to_have_text('Go to TownSquare →')
    town_square_route.tap()
    enter_nearby_institution(
        page, 'town-square', 'TownSquare · Institution Records', 'The Commons at TownSquare'
    )
    institution_records = page.locator(
        '#sheet-content [data-commons-institution-records="true"]'
    )
    expect(institution_records).to_have_count(1)
    institution_records.tap()
    expect(page.locator('#sheet-content [data-chronicle-search="true"]')).to_be_visible()
    institution_chronicle_search = page.locator(
        '#sheet-content [data-chronicle-search="true"]'
    )
    institution_chronicle_search.fill(source_event['eventId'])
    institution_report_card = page.locator(
        '#sheet-content [data-event-id="world:' + source_event['eventId'] + '"]'
    )
    expect(institution_report_card).to_have_count(1)
    archive_route = institution_report_card.locator(
        '[data-chronicle-institution-route="evidence_archive"]'
    )
    expect(archive_route).to_have_count(1)
    expect(archive_route).to_have_text('Go to Evidence Archive →')
    archive_route.tap()
    enter_nearby_institution(page, 'evidence_archive', 'Evidence Archive', 'Evidence Archive')
    after_institution_navigation = authoritative_snapshot(page)
    assert after_institution_navigation == chronicle_route_before, (
        'Chronicle-to-institution routes must change player location only; they cannot create world events, XP or approval.'
    )
    assert after_institution_navigation['xp'] == chronicle_route_before['xp']
    artifact_inspection_before = authoritative_snapshot(page)
    report_cards = page.locator(
        '#sheet-content [data-evidence-archive-activity-stream="report"] [data-evidence-archive-activity-record="report"]'
    )
    open_button = report_cards.first.get_by_role('button', name='Open retained artifact version →', exact=True)
    expect(open_button).to_be_visible()
    open_button.tap()
    expect(page.locator('#version-select')).to_have_value(str(version))
    after_inspection = authoritative_snapshot(page)
    assert after_inspection == artifact_inspection_before, (
        'Opening an exact retained report artifact version must remain read-only.'
    )
    assert after_inspection['xp'] == artifact_inspection_before['xp']


    # Second disconnect: the last accepted shared snapshot remains walkable,
    # but movement is local-only and is discarded when the server position is reconciled.
    if page.locator('#portal').is_visible():
        page.locator('#portal-close').tap()
    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').tap()
    page.wait_for_timeout(1800)
    server_position_before_offline = authoritative_player_position(page)
    offline_start_position = page.evaluate("""() => ({
      x: Number(document.querySelector('#world')?.dataset.playerX),
      y: Number(document.querySelector('#world')?.dataset.playerY),
      source: document.querySelector('#world')?.dataset.playerPositionSource ?? null
    })""")
    offline_route_api_requests = []

    def capture_offline_route_request(request):
        if request.url.startswith(origin + '/api/'):
            offline_route_api_requests.append({
                'method': request.method,
                'path': request.url.split('?', 1)[0][len(origin):]
            })

    page.on('request', capture_offline_route_request)
    page.context.set_offline(True)
    page.wait_for_function(
        """() => document.querySelector('#connection-dot')?.dataset.connectionState === 'offline' &&
            document.querySelector('#world')?.dataset.sharedOfflinePreview === 'true' &&
            document.querySelector('#mode-label')?.textContent.includes('offline preview')""",
        timeout=10000
    )
    expect(page.locator('#connection-dot')).to_have_attribute(
        'aria-label',
        'Shared snapshot preview only. Local travel is not saved to the shared world.'
    )
    page.wait_for_function(
        "() => document.querySelector('#world')?.dataset.movementEnabled === 'true'",
        timeout=10000
    )
    page.locator('#places-button').tap()
    page.get_by_role('button', name='Walk to Polymath Academy', exact=True).tap()
    page.wait_for_function(
        """() => document.querySelector('#world')?.dataset.navigationState === 'walking' &&
            document.querySelector('#world')?.dataset.navigationTargetId === 'academy'""",
        timeout=10000
    )
    enter_nearby_institution(page, 'academy', 'Polymath Academy', 'Polymath Academy')
    offline_end_position = page.evaluate("""() => ({
      x: Number(document.querySelector('#world')?.dataset.playerX),
      y: Number(document.querySelector('#world')?.dataset.playerY),
      source: document.querySelector('#world')?.dataset.playerPositionSource ?? null
    })""")
    assert offline_start_position['source'] == offline_end_position['source'] == 'local-renderer', (
        'Offline travel coordinates must be explicitly identified as renderer-local, not server-authoritative.'
    )
    assert all(math.isfinite(position[key]) for position in (
        offline_start_position, offline_end_position
    ) for key in ('x', 'y')), (
        'The map must expose finite renderer-local coordinates for offline travel verification: ' +
        json.dumps({'start': offline_start_position, 'end': offline_end_position})
    )
    offline_travel_distance = math.hypot(
        offline_end_position['x'] - offline_start_position['x'],
        offline_end_position['y'] - offline_start_position['y']
    )
    assert offline_travel_distance > 100, (
        'Offline preview must allow real local map travel to Polymath Academy: ' +
        json.dumps({
            'start': offline_start_position,
            'end': offline_end_position,
            'distance': offline_travel_distance
        })
    )
    academy_snapshot = page.locator('#sheet-content')
    expect(academy_snapshot).to_have_attribute(
        'data-academy-snapshot-revision', str(refreshed_state['revision'])
    )
    expect(academy_snapshot).to_have_attribute(
        'data-academy-snapshot-freshness', 'stale'
    )
    stale_panel_markers = {
        name: academy_snapshot.get_attribute(name)
        for name in (
            'data-commons-panel',
            'data-chronicle-snapshot-revision',
            'data-evidence-archive-snapshot-revision'
        )
    }
    assert all(value is None for value in stale_panel_markers.values()), (
        'Opening Polymath Academy must clear prior institution root metadata: ' +
        json.dumps(stale_panel_markers)
    )
    academy_notice = academy_snapshot.locator('[data-academy-snapshot-notice="true"]')
    expect(academy_notice).to_have_count(1)
    expect(academy_notice).to_contain_text('SHARED SNAPSHOT · STALE')
    expect(academy_notice).to_contain_text(str(refreshed_state['revision']))
    expect(academy_snapshot.locator(
        '[data-study-card-collection="academy-study-shelf"]'
    )).to_have_count(1)
    assert page.locator('#xp-count').inner_text() == str(refreshed_state['xp']), (
        'Offline map travel and institution inspection must not award world XP.'
    )
    page.screenshot(
        path=str(out / ('offline-academy-map-entry-' + str(width) + '.png')),
        full_page=True
    )
    offline_route_mutations = [
        request for request in offline_route_api_requests
        if request['method'] != 'GET' or request['path'] in (
            '/api/state', '/api/action', '/api/presence', '/api/position'
        )
    ]
    assert not offline_route_mutations, (
        'Offline map travel and Academy entry must not issue shared state, action, presence, position, or write requests: ' +
        json.dumps(offline_route_mutations)
    )
    page.remove_listener('request', capture_offline_route_request)
    page.locator('#sheet-close').tap()
    page.context.set_offline(False)
    page.wait_for_function(
        """() => document.querySelector('#connection-dot')?.dataset.connectionState === 'online' &&
            document.querySelector('#world')?.dataset.sharedOfflinePreview === 'false' &&
            document.querySelector('#world')?.dataset.navigationTargetId === 'none' &&
            document.querySelector('#world')?.dataset.navigationState === 'idle'""",
        timeout=30000
    )
    server_position_after_offline = authoritative_player_position(page)
    assert server_position_after_offline == server_position_before_offline, (
        'The local offline route must not replace the server-accepted shared position.'
    )
    page.wait_for_function(
        """expected => {
          const world = document.querySelector('#world');
          return Math.abs(Number(world?.dataset.playerX) - expected.x) < 1 &&
              Math.abs(Number(world?.dataset.playerY) - expected.y) < 1;
        }""",
        arg=server_position_after_offline,
        timeout=10000
    )

    # Keep Polymath Academy pinned while a separate Witness appends a newer report.
    # The open view must disclose refresh-required, then adopt the accepted revision
    # only after an explicit player action. Refresh itself is a local read-only projection.
    page.locator('#places-button').tap()
    page.get_by_role('button', name='Walk to Polymath Academy', exact=True).tap()
    enter_nearby_institution(page, 'academy', 'Polymath Academy', 'Polymath Academy')
    expect(page.locator('#sheet-title')).to_have_text('Polymath Academy')
    academy_before = authoritative_snapshot(page)
    academy_panel = page.locator('#sheet-content')
    expect(academy_panel).to_have_attribute(
        'data-academy-snapshot-revision', str(academy_before['revision'])
    )
    expect(academy_panel).to_have_attribute('data-academy-snapshot-freshness', 'current')
    expect(academy_panel.locator('[data-academy-snapshot-notice="true"]')).to_have_count(0)

    academy_witness_context = browser.new_context(
        viewport={'width': width, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    academy_witness_page = academy_witness_context.new_page()
    academy_witness_errors = []
    academy_witness_page.on('pageerror', lambda error: academy_witness_errors.append(str(error)))
    try:
        academy_witness_page.goto(url, wait_until='networkidle')
        academy_witness_page.locator('#start-shared').tap()
        academy_witness_page.locator('#world').wait_for(state='visible')
        academy_witness_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        academy_witness_before = authoritative_snapshot(academy_witness_page)
        assert academy_witness_before['viewerRole'] == 'witness'
        assert academy_witness_before['viewerId'] != academy_before['viewerId']
        assert academy_witness_before['revision'] == academy_before['revision'], (
            'The second session must begin from the exact world revision pinned by Polymath Academy.'
        )
        academy_witness_report = post_action(academy_witness_page, {
            'type': 'report',
            'creationId': creation_id,
            'version': version,
            'text': 'Witness report appended while Polymath Academy remains open at an older accepted snapshot; retained activity, not verified truth.',
            'requestId': 'quest-board-academy-refresh-required-' + str(width)
        })
        academy_witness_report_id = academy_witness_report.get('result', {}).get('id')
        assert isinstance(academy_witness_report_id, str) and academy_witness_report_id, (
            'The Witness report must return its exact retained record ID.'
        )
        academy_witness_after = authoritative_snapshot(academy_witness_page)
        assert academy_witness_after['revision'] == academy_witness_before['revision'] + 1, (
            'The Witness report must append exactly one accepted world event.'
        )
        assert academy_witness_after['xp'] == academy_witness_before['xp'], (
            'A report must not award world XP.'
        )
        academy_new_event_ids = [
            event_id for event_id in academy_witness_after['eventIds']
            if event_id not in academy_witness_before['eventIds']
        ]
        assert len(academy_new_event_ids) == 1, (
            'The report must create exactly one retained event: ' + json.dumps(academy_new_event_ids)
        )
        academy_new_event_id = academy_new_event_ids[0]
        assert academy_new_event_id in academy_witness_after['mutuallyVisibleEventIds']
    finally:
        academy_witness_context.close()
    assert not academy_witness_errors, (
        'Witness page errors during Academy refresh acceptance: ' + json.dumps(academy_witness_errors)
    )

    page.wait_for_function(
        "expected => Number(document.querySelector('#world')?.dataset.worldRevision) === expected",
        arg=academy_witness_after['revision'],
        timeout=30000
    )
    expect(academy_panel).to_have_attribute(
        'data-academy-snapshot-revision', str(academy_before['revision'])
    )
    expect(academy_panel).to_have_attribute('data-academy-snapshot-freshness', 'refresh-required')
    academy_refresh_notice = academy_panel.locator('[data-academy-snapshot-notice="true"]')
    expect(academy_refresh_notice).to_have_count(1)
    expect(academy_refresh_notice).to_contain_text('SHARED SNAPSHOT · REFRESH AVAILABLE')
    expect(academy_refresh_notice).to_have_attribute(
        'data-snapshot-revision', str(academy_before['revision'])
    )
    expect(academy_refresh_notice).to_have_attribute(
        'data-current-revision', str(academy_witness_after['revision'])
    )
    expect(academy_refresh_notice).to_contain_text('remains pinned')
    academy_refresh_button = academy_refresh_notice.locator('[data-academy-refresh="true"]')
    expect(academy_refresh_button).to_have_count(1)
    expect(academy_refresh_button).to_be_visible()
    expect(academy_refresh_button).to_be_enabled()
    page.screenshot(
        path=str(out / ('academy-refresh-required-' + str(width) + '.png')),
        full_page=True
    )

    founder_before_academy_refresh = authoritative_snapshot(page)
    assert founder_before_academy_refresh['revision'] == academy_witness_after['revision']
    assert academy_new_event_id in founder_before_academy_refresh['mutuallyVisibleEventIds']
    assert founder_before_academy_refresh['xp'] == academy_before['xp'], (
        'Accepting a newer report while Academy is open must not award Founder XP.'
    )
    assert academy_witness_after['xp'] == academy_witness_before['xp']

    academy_refresh_api_requests = []
    academy_origin = page.evaluate("() => location.origin")

    def capture_academy_refresh_request(request):
        if request.url.startswith(academy_origin + '/api/'):
            academy_refresh_api_requests.append({
                'method': request.method,
                'path': request.url.split('?', 1)[0][len(academy_origin):]
            })

    page.on('request', capture_academy_refresh_request)
    academy_refresh_button.tap()
    page.remove_listener('request', capture_academy_refresh_request)
    assert not academy_refresh_api_requests, (
        'Refreshing the pinned Academy projection must not write to or request shared state: ' +
        json.dumps(academy_refresh_api_requests)
    )
    expect(page.locator('#sheet-title')).to_have_text('Polymath Academy')
    expect(academy_panel).to_have_attribute(
        'data-academy-snapshot-revision', str(academy_witness_after['revision'])
    )
    expect(academy_panel).to_have_attribute('data-academy-snapshot-freshness', 'current')
    expect(academy_panel.locator('[data-academy-snapshot-notice="true"]')).to_have_count(0)
    academy_after_refresh = authoritative_snapshot(page)
    assert academy_after_refresh == founder_before_academy_refresh, (
        'Explicit Academy refresh must replace only the local projection, preserving the accepted world and viewer state.'
    )
    assert academy_new_event_id in academy_after_refresh['mutuallyVisibleEventIds']
    assert academy_after_refresh['xp'] == academy_before['xp']
    page.screenshot(
        path=str(out / ('academy-refresh-current-' + str(width) + '.png')),
        full_page=True
    )

    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').tap()
    layout = page.evaluate("""() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    })""")
    assert layout['documentWidth'] <= layout['viewportWidth'] + 1, (
        'Evidence Archive activity streams caused horizontal overflow: ' + json.dumps(layout)
    )
    assert not errors, 'Browser page errors during Evidence Archive activity stream acceptance: ' + json.dumps(errors)
    screenshot = out / ('evidence-archive-activity-streams-' + str(width) + '.png')
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        'journey': 'evidence-archive-activity-streams-mobile-' + str(width),
        'passed': True,
        'viewport': width,
        'baselineReportIds': baseline_streams['reports'],
        'baselineContributionIds': baseline_streams['contributions'],
        'reportIds': report_ids,
        'reportDisplayIds': report_display_ids,
        'reportAppendPositions': report_positions,
        'contributionIds': contribution_ids,
        'contributionDisplayIds': contribution_display_ids,
        'contributionAppendPositions': contribution_positions,
        'orderingBasis': 'retained-append-position',
        'scope': 'actor-visible-collection',
        'submissionRevisionDelta': 4,
        'submissionXpDelta': after_actions['xp'] - baseline['xp'],
        'inspectionReadOnly': True,
        'offlineChronicleNavigation': True,
        'chronicleInstitutionRouting': True,
        'institutionRouteFromReport': 'town-square',
        'institutionRouteBackToArchive': 'evidence_archive',
        'institutionNavigationReadOnly': after_institution_navigation == chronicle_route_before,
        'institutionNavigationXpDelta': after_institution_navigation['xp'] - chronicle_route_before['xp'],
        'returnToArchiveWhileOffline': True,
        'archivePinnedWhileOffline': True,
        'archiveSnapshotRevision': inspection_before['revision'],
        'acceptedRevisionWhileOffline': accepted_revision_while_offline,
        'acceptedRevisionWhileConnected': accepted_revision_while_connected,
        'offlineChronicleSnapshotRevision': inspection_before['revision'],
        'offlineChronicleExcludedNewerReportEventId': new_report_event_id,
        'returnToArchiveSnapshotRevision': inspection_before['revision'],
        'offlineSharedApiRequestCount': len(offline_api_requests),
        'offlineSharedApiMutationCount': len(offline_api_mutations),
        'secondSessionReportId': new_report_id,
        'secondSessionViewerRole': second_before['viewerRole'],
        'secondSessionActorDistinct': second_before['viewerId'] != after_actions['viewerId'],
        'secondSessionReportActorId': new_report_events[0]['actorId'],
        'secondSessionReportActorRole': new_report_events[0]['actorRole'],
        'secondSessionReportAppendPosition': new_report_events[0]['eventPosition'],
        'witnessArchiveSourceAppendPosition': int(witness_source_position),
        'secondSessionRevisionDelta': second_after['revision'] - second_before['revision'],
        'secondSessionXpDelta': second_after['xp'] - second_before['xp'],
        'archiveRefreshAfterReconnect': True,
        'reconnectedArchiveRevision': refreshed_state['revision'],
        'academyRefresh': {
            'requiredWhileOpen': True,
            'snapshotRevision': academy_before['revision'],
            'acceptedRevision': academy_witness_after['revision'],
            'witnessReportId': academy_witness_report_id,
            'witnessEventId': academy_new_event_id,
            'buttonAction': 'read-only-local-projection-refresh',
            'sharedApiRequestCount': len(academy_refresh_api_requests),
            'xpDelta': academy_after_refresh['xp'] - founder_before_academy_refresh['xp'],
            'worldRevisionDelta': academy_after_refresh['revision'] - founder_before_academy_refresh['revision'],
            'eventIdsUnchanged': academy_after_refresh['eventIds'] == founder_before_academy_refresh['eventIds'],
            'currentAfterRefresh': True,
            'screenshots': [
                'academy-refresh-required-' + str(width) + '.png',
                'academy-refresh-current-' + str(width) + '.png'
            ]
        },
        'exactChronicleSourceNavigation': True,
        'sourceEventId': source_event['eventId'],
        'sourceEventPosition': source_event['eventPosition'],
        'sourceEventType': source_event['type'],
        'sourceEventRecordType': target_record_type,
        'exactArtifactVersionNavigation': True,
        'horizontalOverflow': False,
        'screenshot': screenshot.name
    }


def run_evidence_archive_activity_streams_mobile(browser, url, out, width):
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
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
        )
        page.locator('#login-button').tap()
        page.locator('#founder-name').fill('Damien')
        page.locator('#founder-key').fill('fake-browser-fixture-key-not-a-secret')
        page.locator('#verify-founder').tap()
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
        return assert_evidence_archive_activity_streams_mobile(page, out, width, errors, browser, url)
    finally:
        context.close()


def run_viewport(browser, url, out, width, source_archive_fixture=None, source_archive_failure=None):
    context = browser.new_context(
        viewport={'width': width, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    page = context.new_page()
    errors = []
    failure_chronicle_result = None
    contradiction_clerk_result = None
    publication_chronicle_result = None
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
            # The 320px viewport has already published the shared Source Archive.
            # Assert these two unrelated fixtures relative to the actual shared-world
            # baseline rather than stale empty-world totals.
            fixture_baseline = authoritative_snapshot(page)
            expected_creation_count = len(fixture_baseline['creationVersions']) + 2
            expected_xp = fixture_baseline['xp'] + 200
            fixture = publish_fixture(page)
            observatory_fixture = publish_observatory_fixture(page)
            page.wait_for_function(
                "expected => document.querySelector('#creation-count')?.textContent === String(expected.creationCount) && "
                "document.querySelector('#xp-count')?.textContent === String(expected.xp)",
                arg={'creationCount': expected_creation_count, 'xp': expected_xp}
            )
            fixture_after = authoritative_snapshot(page)
            assert fixture_after['revision'] == fixture_baseline['revision'] + 4, (
                'The two mobile setup publications must append exactly two draft and two publish events.'
            )
            assert len(fixture_after['creationVersions']) == expected_creation_count, (
                'The two mobile setup publications must add exactly two retained creations.'
            )
            assert fixture_after['xp'] == expected_xp, (
                'The two existing publication rewards must add exactly 200 XP relative to the shared baseline.'
            )
            guild_circuit_result = run_guild_dissent_circuit(
                browser, page, url, observatory_fixture, out
            )
            publication_chronicle_result = assert_publication_chronicle_navigation(
                page, fixture, out, width
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
            enter_button = page.locator('#enter-institution-button')
            if enter_button.is_visible():
                enter_button.tap()
            else:
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

        source_archive_founder_chain = None
        source_archive_witness_chain = None
        founder_fresh_client = None
        if width == 320:
            page.locator('#sheet-close').tap()
            archive_before = authoritative_snapshot(page)
            source_archive_fixture = publish_source_archive_fixture(page)
            page.wait_for_function(
                "() => document.querySelector('#creation-count')?.textContent === '1' && " 
                "document.querySelector('#xp-count')?.textContent === '100'"
            )
            archive_after = authoritative_snapshot(page)
            assert archive_after['revision'] == archive_before['revision'] + 2, (
                'The synthetic Source Archive fixture must retain one draft and one publication event.'
            )
            assert archive_after['xp'] == archive_before['xp'] + 100, (
                'Only the existing explicit publication reward may change XP in this fixture setup.'
            )
            publication_chronicle_result = assert_publication_chronicle_navigation(
                page, source_archive_fixture, out, width
            )
            source_archive_failure = record_source_archive_failure(page)
            failure_chronicle_result = assert_source_archive_failure_chronicle(
                page, source_archive_failure, 'founder'
            )
            source_archive_founder_chain = run_source_archive_quest_chain(
                page, 'founder', source_archive_fixture, out, '320'
            )
            contradiction_clerk_result = run_contradiction_clerk_mobile_journey(
                page, source_archive_fixture, out, width, 'founder'
            )
        else:
            assert source_archive_fixture and source_archive_fixture.get('fixtureOnly') is True, (
                'The 390px journey must reuse the exact Source Archive published by the 320px journey.'
            )
            source_archive_founder_chain = source_archive_research_snapshot(
                page, before['viewerId'], 'founder', source_archive_fixture,
                'Source Archive workflow · Founder', True
            )
            assert_source_archive_objectives(page, 'founder', '1/1', '1/1', '1/1', '2/2')

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
            assert source_archive_failure and source_archive_failure.get('eventId'), (
                'The 390px Witness journey must inspect the exact failure event retained by the 320px Founder journey.'
            )
            # This helper reloads and re-enters the authenticated Witness world
            # before checking the shared Chronicle. Take the Quest Board's
            # read-only baseline after that fresh-client recovery.
            failure_chronicle_result = assert_source_archive_failure_chronicle(
                page, source_archive_failure, 'witness'
            )
            # Entering the Quest Board is a world/location interaction. Start
            # the read-only comparison only after the player has arrived.
            open_quest_board(page)
            witness_before = authoritative_snapshot(page)
            assert witness_before['viewerRole'] == 'witness'
            witness_rows = assert_board(page, 'witness')
            founder_rows = page.locator('#sheet-content [data-objective-id^="founder-"]')
            witness_objectives = page.locator('#sheet-content [data-objective-id^="witness-"]')
            assert founder_rows.count() == 0, 'A Witness must not receive Founder objectives.'
            assert witness_objectives.count() > 0, 'A Witness must receive the Witness objective trail.'
            assert_source_archive_objectives(page, 'witness', '0/1', '0/1')
            witness_after = authoritative_snapshot(page)
            assert witness_after == witness_before, (
                'The Witness board is also a read-only projection of the shared world.'
            )
            page.locator('#sheet-close').tap()
            source_archive_witness_chain = run_source_archive_quest_chain(
                page, 'witness', source_archive_fixture, out, '390'
            )
            contradiction_clerk_result = run_contradiction_clerk_mobile_journey(
                page, source_archive_fixture, out, width, 'witness'
            )
            founder_fresh_client = verify_founder_source_archive_progress(
                browser, url, out, before['viewerId'], source_archive_fixture
            )
            witness_result = {
                'viewerRole': witness_before['viewerRole'],
                'founderObjectivesHidden': True,
                'witnessObjectivesVisible': True,
                'witnessSourceArchiveChain': source_archive_witness_chain,
                'founderProgressAfterWitnessActivity': founder_fresh_client,
                'contradictionClerk': contradiction_clerk_result,
                'worldStateUnchangedByBoardInspection': True
            }

        publication_snapshot_result = assert_publication_snapshot_pinning(
            browser, page, source_archive_fixture, out, width
        )

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
            'publicationChronicle': publication_chronicle_result,
            'publicationSnapshotPinning': publication_snapshot_result,
            'guildDissentCircuit': guild_circuit_result,
            'recordedFounderObjective': bool(fixture),
            'sourceArchiveFixture': source_archive_fixture,
            'sourceArchiveFailure': source_archive_failure,
            'sourceArchiveFailureChronicle': failure_chronicle_result,
            'sourceArchiveFounderChain': source_archive_founder_chain,
            'sourceArchiveWitnessChain': source_archive_witness_chain,
            'founderFreshClientProgress': founder_fresh_client,
            'contradictionClerk': contradiction_clerk_result,
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




def assert_publication_snapshot_pinning(browser, page, publication, out, width):
    """Prove an artifact detail and its Chronicle round-trip stay on one accepted snapshot."""
    assert publication and publication.get('creationId') and publication.get('version'), (
        'Publication snapshot pinning requires one exact retained artifact version.'
    )
    if not page.locator('#sheet').is_hidden():
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()
    page.bring_to_front()
    # A two-edition custom artifact makes the selected receipt observably
    # different from the creation's current receipt. Reuse it across the
    # 320px and 390px journeys rather than publishing duplicate fixtures.
    receipt_fixture_title = 'NGL Historical Edition Receipt Fixture'
    receipt_fixture_intent_v1 = 'Edition one: verify that the displayed receipt follows the selected retained edition.'
    receipt_fixture_intent_v2 = 'Edition two: a different retained document with its own byte receipt.'
    receipt_fixture = page.evaluate("""async title => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Receipt fixture lookup could not read the accepted world.');
      const dto = await response.json();
      const matches = (dto.world?.creations ?? []).filter(item =>
        item?.kind === 'custom' && item?.title === title
      );
      if (matches.length > 1) throw new Error('Historical receipt fixture is ambiguous.');
      return matches.length ? {
        creationId: matches[0].id,
        currentVersion: matches[0].version,
        historicalCount: Array.isArray(matches[0].versions) ? matches[0].versions.length : -1
      } : null;
    }""", receipt_fixture_title)
    if receipt_fixture is None:
        first_draft = post_action(page, {
            'type': 'draft',
            'kind': 'custom',
            'title': receipt_fixture_title,
            'intent': receipt_fixture_intent_v1,
            'html': '<article><h1>Edition one</h1><p>Original retained bytes for receipt selection.</p></article>',
            'requestId': 'publication-receipt-fixture-draft-v1'
        })
        first_draft_id = first_draft.get('result', {}).get('draftId')
        assert isinstance(first_draft_id, str) and first_draft_id, (
            'The historical receipt fixture must return its first draft ID.'
        )
        first_publication = post_action(page, {
            'type': 'publish',
            'draftId': first_draft_id,
            'expectedVersion': 0,
            'requestId': 'publication-receipt-fixture-publish-v1'
        })
        receipt_creation_id = first_publication.get('result', {}).get('creationId')
        assert isinstance(receipt_creation_id, str) and receipt_creation_id, (
            'The historical receipt fixture must retain its first publication.'
        )
        assert first_publication.get('result', {}).get('version') == 1
        second_draft = post_action(page, {
            'type': 'repair',
            'creationId': receipt_creation_id,
            'expectedVersion': 1,
            'intent': receipt_fixture_intent_v2,
            'html': '<article><h1>Edition two</h1><p>Different retained bytes for receipt selection.</p></article>',
            'requestId': 'publication-receipt-fixture-repair-v2'
        })
        second_draft_id = second_draft.get('result', {}).get('draftId')
        assert isinstance(second_draft_id, str) and second_draft_id, (
            'The historical receipt fixture must return its second draft ID.'
        )
        second_publication = post_action(page, {
            'type': 'publish',
            'draftId': second_draft_id,
            'expectedVersion': 1,
            'requestId': 'publication-receipt-fixture-publish-v2'
        })
        assert second_publication.get('result', {}).get('creationId') == receipt_creation_id
        assert second_publication.get('result', {}).get('version') == 2
        receipt_fixture = {
            'creationId': receipt_creation_id,
            'currentVersion': 2,
            'historicalCount': 1
        }
    assert receipt_fixture['currentVersion'] == 2 and receipt_fixture['historicalCount'] == 1, (
        'The receipt fixture must retain exactly two distinct published editions.'
    )
    versioned_publication = {'creationId': receipt_fixture['creationId'], 'version': 1}

    page.locator('#places-button').tap()
    route = page.get_by_role('button', name='Walk to Publication House', exact=True)
    expect(route).to_be_visible()
    route.tap()
    enter_nearby_institution(page, 'publication_house', 'Publication House', 'Publication House')

    receipt_target = page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Receipt fixture oracle could not read the accepted world.');
      const dto = await response.json();
      const creations = dto.world?.creations ?? [];
      const events = dto.world?.events ?? [];
      const matches = creations.filter(item => item?.id === expected.creationId);
      if (matches.length !== 1) throw new Error('The versioned receipt fixture is missing or ambiguous.');
      const creation = matches[0];
      const versions = [...(Array.isArray(creation.versions) ? creation.versions : []), creation]
        .filter(item => item?.version === expected.version);
      if (versions.length !== 1) throw new Error('The exact retained receipt fixture version is missing or ambiguous.');
      const version = versions[0];
      const publications = events.filter(event => event?.type === 'publish' &&
        event.creationId === expected.creationId && event.version === expected.version);
      if (publications.length !== 1 || publications[0].actor?.role !== 'founder' ||
          typeof publications[0].id !== 'string' || !publications[0].id ||
          publications[0].id.trim() !== publications[0].id ||
          publications[0].at !== version.publishedAt) {
        throw new Error('The exact receipt fixture version does not have one unambiguous Founder publication event.');
      }
      return {
        title: creation.title,
        kind: creation.kind,
        version: version.version,
        currentVersion: creation.version,
        selectedReceipt: version.receipt,
        currentReceipt: creation.receipt,
        selectedHtml: version.html,
        currentHtml: creation.html,
        selectedIntent: version.intent,
        currentIntent: creation.intent,
        eventId: publications[0].id,
        publishedAt: version.publishedAt
      };
    }""", versioned_publication)
    artifact = page.get_by_role(
        'button', name=f"{receipt_target['title']} · {receipt_target['kind']} · v{receipt_target['currentVersion']}", exact=True
    )
    expect(artifact).to_have_count(1)
    artifact.tap()
    expect(page.locator('#sheet-title')).to_have_text(receipt_target['title'])
    expect(page.locator('#version-select')).to_have_value(str(receipt_target['currentVersion']))

    current_receipt = page.locator('#sheet-content .receipt')
    expect(current_receipt).to_have_count(1)
    current_bytes = receipt_target['currentHtml'].encode('utf-8')
    historical_bytes = receipt_target['selectedHtml'].encode('utf-8')
    assert hashlib.sha256(current_bytes).hexdigest() == receipt_target['currentReceipt']['digest'], (
        'The current edition receipt must match the exact current HTML bytes.'
    )
    assert len(current_bytes) == receipt_target['currentReceipt']['size'], (
        'The current edition receipt size must match the exact current HTML bytes.'
    )
    assert hashlib.sha256(historical_bytes).hexdigest() == receipt_target['selectedReceipt']['digest'], (
        'The historical edition receipt must match the exact retained HTML bytes.'
    )
    assert len(historical_bytes) == receipt_target['selectedReceipt']['size'], (
        'The historical edition receipt size must match the exact retained HTML bytes.'
    )
    assert receipt_target['currentReceipt']['digest'] != receipt_target['selectedReceipt']['digest'], (
        'The two-edition fixture must distinguish current and historical byte receipts.'
    )
    expect(current_receipt).to_contain_text(receipt_target['currentReceipt']['digest'])
    expect(current_receipt).to_contain_text('v' + str(receipt_target['currentVersion']))
    page.locator('#version-select').select_option(str(receipt_target['version']))
    expect(page.locator('#version-select')).to_have_value(str(receipt_target['version']))
    expect(current_receipt).to_contain_text(receipt_target['selectedReceipt']['digest'])
    expect(current_receipt).to_contain_text('v' + str(receipt_target['version']))

    page.locator('#sheet-close').tap()
    expect(page.locator('#sheet')).to_be_hidden()
    enter_nearby_institution(page, 'publication_house', 'Publication House', 'Publication House')

    target = page.evaluate("""async expected => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Publication snapshot oracle could not read the accepted world.');
      const dto = await response.json();
      const creations = dto.world?.creations ?? [];
      const events = dto.world?.events ?? [];
      const matches = creations.filter(item => item?.id === expected.creationId);
      if (matches.length !== 1) throw new Error('The publication target is missing or ambiguous.');
      const creation = matches[0];
      const versions = [...(Array.isArray(creation.versions) ? creation.versions : []), creation]
        .filter(item => item?.version === expected.version);
      if (versions.length !== 1) throw new Error('The exact retained publication version is missing or ambiguous.');
      const version = versions[0];
      const publications = events.filter(event => event?.type === 'publish' &&
        event.creationId === expected.creationId && event.version === expected.version);
      if (publications.length !== 1 || publications[0].actor?.role !== 'founder' ||
          typeof publications[0].id !== 'string' || !publications[0].id ||
          publications[0].id.trim() !== publications[0].id ||
          publications[0].at !== version.publishedAt) {
        throw new Error('The exact artifact version does not have one unambiguous Founder publication event.');
      }
      return {
        title: creation.title,
        kind: creation.kind,
        version: version.version,
        currentVersion: creation.version,
        selectedReceipt: version.receipt,
        currentReceipt: creation.receipt,
        selectedHtml: version.html,
        currentHtml: creation.html,
        eventId: publications[0].id,
        publishedAt: version.publishedAt
      };
    }""", publication)
    artifact = page.get_by_role(
        'button', name=f"{target['title']} · {target['kind']} · v{target['currentVersion']}", exact=True
    )
    expect(artifact).to_have_count(1)
    artifact.tap()
    expect(page.locator('#sheet-title')).to_have_text(target['title'])
    expect(page.locator('#version-select')).to_have_value(str(target['version']))
    source_receipt = page.locator('#sheet-content .receipt')
    expect(source_receipt).to_contain_text(target['selectedReceipt']['digest'])
    pinned = authoritative_snapshot(page)

    witness_context = browser.new_context(
        viewport={'width': width, 'height': 844},
        is_mobile=True,
        has_touch=True
    )
    witness_page = witness_context.new_page()
    witness_errors = []
    witness_page.on('pageerror', lambda error: witness_errors.append(str(error)))
    try:
        witness_page.goto(page.url.split('/')[0] + '//' + page.url.split('/')[2], wait_until='networkidle')
        witness_page.locator('#start-shared').tap()
        witness_page.locator('#world').wait_for(state='visible')
        witness_page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
        witness_before = authoritative_snapshot(witness_page)
        assert witness_before['viewerRole'] == 'witness'
        assert witness_before['viewerId'] != pinned['viewerId'], (
            'The snapshot update must come from a separate pseudonymous session actor.'
        )
        post_action(witness_page, {
            'type': 'report',
            'creationId': publication['creationId'],
            'version': publication['version'],
            'text': 'Snapshot-pin acceptance report. This is attributed activity, not independent evidence or a truth verdict.',
            'requestId': 'publication-snapshot-pin-report-' + str(width)
        })
        witness_after = authoritative_snapshot(witness_page)
        assert witness_after['revision'] == witness_before['revision'] + 1, (
            'The second session must append exactly one report event.'
        )
        assert witness_after['xp'] == witness_before['xp'], (
            'A report used to advance the snapshot must not award XP.'
        )
        page.wait_for_function(
            """expected => Number(document.querySelector('#world')?.dataset.worldRevision) === expected""",
            arg=witness_after['revision']
        )

        link = page.locator('#publication-chronicle-link')
        expect(link).to_have_count(1)
        expect(link).to_have_attribute('data-publication-chronicle-event-id', target['eventId'])
        link.tap()
        expect(page.locator('#sheet-title')).to_have_text('World Chronicle')
        chronicle_content = page.locator('#sheet-content')
        expect(chronicle_content).to_have_attribute(
            'data-chronicle-snapshot-revision', str(pinned['revision'])
        )
        expect(chronicle_content).to_have_attribute(
            'data-chronicle-snapshot-freshness-reason', 'revision-mismatch'
        )
        exact_event = chronicle_content.locator(
            '[data-event-id="world:' + target['eventId'] + '"]'
        )
        expect(exact_event).to_have_count(1)
        expect(exact_event).to_contain_text('Publication recorded')
        inspect = exact_event.locator(
            '[data-chronicle-target="' + publication['creationId'] +
            '"][data-chronicle-version="' + str(publication['version']) + '"]'
        )
        expect(inspect).to_have_count(1)
        inspect.tap()

        expect(page.locator('#sheet-title')).to_have_text(target['title'])
        expect(page.locator('#version-select')).to_have_value(str(target['version']))
        roundtrip_receipt = page.locator('#sheet-content .receipt')
        expect(roundtrip_receipt).to_contain_text(target['selectedReceipt']['digest'])
        expect(roundtrip_receipt).to_contain_text('v' + str(target['version']))
        detail = page.locator('#sheet-content')
        expect(detail).to_have_attribute('data-creation-snapshot-revision', str(pinned['revision']))
        expect(detail).to_have_attribute('data-creation-snapshot-freshness', 'refresh-required')
        expect(detail.locator('[data-creation-snapshot-refresh]')).to_be_visible()

        # The Witness has advanced the accepted shared world while this detail
        # remains pinned. Verify every write route exposed to this session is
        # blocked before it reaches the shared action endpoint. Founder-only
        # repair must be tested for Founder and absent for Witness.
        before_guard = authoritative_snapshot(page)
        blocked_action_requests = []

        def capture_blocked_action_request(request):
            if request.method == 'POST' and request.url.split('?', 1)[0].endswith('/api/action'):
                blocked_action_requests.append({
                    'method': request.method,
                    'path': request.url.split('?', 1)[0]
                })

        page.on('request', capture_blocked_action_request)
        try:
            page.locator('#contribution-text').fill(
                'Stale-snapshot acceptance attempt. This must remain local and must not become a world event.'
            )
            page.locator('#contribute-button').tap()
            expect(page.locator('#toast')).to_be_visible()
            expect(page.locator('#toast')).to_contain_text(
                'pinned to an older or unavailable shared snapshot'
            )

            report_disclosure = page.locator('#sheet-content details').filter(
                has_text='Report a problem or unsupported claim'
            )
            expect(report_disclosure).to_have_count(1)
            report_disclosure.locator('summary').tap()
            page.locator('#report-text').fill(
                'Stale-snapshot report attempt. No report should be submitted from this edition.'
            )
            page.locator('#report-button').tap()
            expect(page.locator('#toast')).to_contain_text(
                'pinned to an older or unavailable shared snapshot'
            )

            blocked_actions = ['contribute', 'report']
            repair_hidden_by_role = False
            if before_guard['viewerRole'] == 'founder':
                expect(page.locator('#repair-button')).to_have_count(1)
                page.locator('#repair-button').tap()
                expect(page.locator('#toast')).to_contain_text(
                    'pinned to an older or unavailable shared snapshot'
                )
                blocked_actions.append('repair')
            elif before_guard['viewerRole'] == 'witness':
                # Repair is Founder-only. A Witness must not be offered a
                # control that it could never authorize, even before freshness checks.
                expect(page.locator('#repair-button')).to_have_count(0)
                repair_hidden_by_role = True
            else:
                raise AssertionError(
                    'Stale-write acceptance requires a Founder or Witness session.'
                )
            expect(page.locator('#sheet-title')).to_have_text(target['title'])
        finally:
            page.remove_listener('request', capture_blocked_action_request)

        after_guard = authoritative_snapshot(page)
        assert not blocked_action_requests, (
            'Stale artifact actions must be rejected before POST /api/action: ' +
            json.dumps(blocked_action_requests, sort_keys=True)
        )
        assert shared_world_snapshot(after_guard) == shared_world_snapshot(before_guard), (
            'Blocked stale-detail actions must not append events or mutate the accepted world.'
        )
        assert after_guard['xp'] == before_guard['xp'], (
            'Blocked stale-detail actions must award no XP.'
        )
        assert detail.get_attribute('data-creation-snapshot-revision') == str(pinned['revision'])
        assert detail.get_attribute('data-creation-snapshot-freshness') == 'refresh-required'
        assert detail.locator('[data-creation-snapshot-refresh]').is_visible()
        stale_write_guard = {
            'pinnedRevision': pinned['revision'],
            'acceptedRevision': witness_after['revision'],
            'viewerRole': before_guard['viewerRole'],
            'blockedActions': blocked_actions,
            'repairHiddenByRole': repair_hidden_by_role,
            'actionRequests': len(blocked_action_requests),
            'readOnly': shared_world_snapshot(after_guard) == shared_world_snapshot(before_guard),
            'xpDelta': after_guard['xp'] - before_guard['xp'],
            'snapshotRemainedPinned': detail.get_attribute('data-creation-snapshot-revision') == str(pinned['revision'])
        }
        page.screenshot(
            path=str(out / ('publication-stale-write-guard-' + str(width) + '.png')),
            full_page=True
        )

        before_refresh = authoritative_snapshot(page)
        page.evaluate("""() => {
          window.__creationRefreshApiRequests = 0;
          const originalFetch = window.fetch;
          window.fetch = function(input, init) {
            const raw = typeof input === 'string' ? input : (input?.url || String(input));
            if (new URL(raw, location.href).pathname.startsWith('/api/')) {
              window.__creationRefreshApiRequests += 1;
            }
            return originalFetch.call(this, input, init);
          };
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            if (new URL(String(url), location.href).pathname.startsWith('/api/')) {
              window.__creationRefreshApiRequests += 1;
            }
            return originalOpen.call(this, method, url, ...rest);
          };
        }""")
        detail.locator('[data-creation-snapshot-refresh]').tap()
        page.wait_for_function(
            """expected => {
              const content = document.querySelector('#sheet-content');
              return content?.dataset.creationSnapshotRevision === String(expected) &&
                content?.dataset.creationSnapshotFreshness === 'current' &&
                !content.querySelector('[data-creation-snapshot-notice]');
            }""",
            arg=witness_after['revision']
        )
        refresh_api_requests = page.evaluate("window.__creationRefreshApiRequests")
        after_refresh = authoritative_snapshot(page)
        assert refresh_api_requests == 0, (
            'Refreshing the artifact detail must use the accepted in-memory snapshot, not shared API requests.'
        )
        assert shared_world_snapshot(after_refresh) == shared_world_snapshot(before_refresh), (
            'Artifact snapshot refresh must not mutate the shared world.'
        )
        assert after_refresh['xp'] == before_refresh['xp'], (
            'Artifact snapshot refresh must not award XP.'
        )
        assert after_refresh['revision'] == before_refresh['revision'], (
            'Artifact snapshot refresh must not append a world event.'
        )
        refreshed_link = page.locator('#publication-chronicle-link')
        expect(refreshed_link).to_have_attribute('data-publication-chronicle-event-id', target['eventId'])
        screenshot = out / ('publication-snapshot-pin-' + str(width) + '.png')
        page.screenshot(path=str(screenshot), full_page=True)
        page.locator('#sheet-close').tap()
        expect(page.locator('#sheet')).to_be_hidden()
        assert not witness_errors, 'Witness snapshot-update page errors: ' + json.dumps(witness_errors)
        return {
            'journey': 'publication-detail-chronicle-snapshot-pin-' + str(width),
            'pinnedRevision': pinned['revision'],
            'acceptedRevision': witness_after['revision'],
            'chronicleRevision': pinned['revision'],
            'roundTripDetailRevision': pinned['revision'],
            'staleWriteGuard': stale_write_guard,
            'refreshedRevision': after_refresh['revision'],
            'refreshApiRequests': refresh_api_requests,
            'worldMutationOnRefresh': shared_world_snapshot(after_refresh) != shared_world_snapshot(before_refresh),
            'xpDeltaOnRefresh': after_refresh['xp'] - before_refresh['xp'],
            'separateSessionActor': witness_after['viewerId'] != pinned['viewerId'],
            'exactPublicationEvent': target['eventId'],
            'editionReceipt': {
                'selectedVersion': receipt_target['version'],
                'selectedDigest': receipt_target['selectedReceipt']['digest'],
                'currentVersion': receipt_target['currentVersion'],
                'currentDigest': receipt_target['currentReceipt']['digest'],
                'differentEditionBytes': receipt_target['selectedReceipt']['digest'] != receipt_target['currentReceipt']['digest'],
                'bothDigestsRecomputedFromExactHtml': True
            },
            'screenshot': screenshot.name
        }
    finally:
        witness_context.close()

def run_source_archive_mobile_retry(browser, url, out, observatory_fixture, source_archive_fixture, retry_attempts_path):
    assert observatory_fixture and observatory_fixture.get('creationId'), (
        'The retry journey requires the exact retained Source Observatory publication from the 390px setup.'
    )
    assert source_archive_fixture and source_archive_fixture.get('creationId') and source_archive_fixture.get('version'), (
        'The legacy pending predicate migration requires the published Source Archive from the Quest Board journey.'
    )
    context = browser.new_context(
        viewport={'width': 390, 'height': 844},
        is_mobile=True,
        has_touch=True,
        service_workers='block'
    )
    page = context.new_page()
    cdp = context.new_cdp_session(page)
    cdp_contexts = {}
    cdp_frames = {}
    cdp_exceptions = []

    def capture_execution_context(event):
        context_info = event.get('context') or {}
        auxiliary = context_info.get('auxData') or {}
        context_id = context_info.get('id')
        if context_id is not None:
            cdp_contexts[context_id] = {
                'frameId': auxiliary.get('frameId'),
                'isDefault': auxiliary.get('isDefault'),
                'type': context_info.get('type'),
                'name': context_info.get('name'),
                'origin': context_info.get('origin')
            }

    def capture_frame_attached(event):
        frame_id = event.get('frameId')
        if frame_id:
            current = cdp_frames.setdefault(frame_id, {'id': frame_id})
            current['parentId'] = event.get('parentFrameId')

    def capture_frame_navigated(event):
        frame_info = event.get('frame') or {}
        frame_id = frame_info.get('id')
        if frame_id:
            current = cdp_frames.setdefault(frame_id, {'id': frame_id})
            current.update({
                'parentId': frame_info.get('parentId'),
                'name': frame_info.get('name') or '',
                'url': frame_info.get('url') or '',
                'securityOrigin': frame_info.get('securityOrigin') or ''
            })

    def capture_cdp_exception(event):
        details = event.get('exceptionDetails') or {}
        context_id = details.get('executionContextId')
        context_info = cdp_contexts.get(context_id) or {}
        frame_id = context_info.get('frameId')
        frame_info = cdp_frames.get(frame_id) or {}
        exception = details.get('exception') or {}
        description = exception.get('description') or ''
        first_line = description.splitlines()[0] if description else ''
        if first_line.startswith('SecurityError: '):
            exception_name = 'SecurityError'
            exception_message = first_line[len('SecurityError: '):]
        else:
            exception_name = exception.get('className')
            exception_message = first_line or details.get('text') or ''
        cdp_exceptions.append({
            'executionContextId': context_id,
            'executionContextName': context_info.get('name'),
            'executionContextType': context_info.get('type'),
            'executionContextIsDefault': context_info.get('isDefault'),
            'frameId': frame_id,
            'frameNameAtException': frame_info.get('name'),
            'frameUrlAtException': frame_info.get('url'),
            'frameParentId': frame_info.get('parentId'),
            'exceptionName': exception_name,
            'message': exception_message,
            'description': first_line,
            'scriptUrl': details.get('url') or '',
            'lineNumber': details.get('lineNumber'),
            'columnNumber': details.get('columnNumber'),
            'exceptionText': details.get('text') or ''
        })

    cdp.on('Runtime.executionContextCreated', capture_execution_context)
    cdp.on('Page.frameAttached', capture_frame_attached)
    cdp.on('Page.frameNavigated', capture_frame_navigated)
    cdp.on('Runtime.exceptionThrown', capture_cdp_exception)
    cdp.send('Page.enable')
    cdp.send('Runtime.enable')
    errors = []
    frame_events = []
    preview_requests = []
    action_requests = []
    action_response_objects = []
    predicate_action_requests = []
    predicate_action_response_objects = []

    def frame_identity(frame):
        try:
            return {'name': frame.name, 'url': frame.url}
        except Exception as error:
            return {'error': str(error)}

    def capture_page_error(error):
        errors.append({
            'name': getattr(error, 'name', None),
            'message': str(error),
            'stack': getattr(error, 'stack', None),
            'framesAtError': [frame_identity(frame) for frame in page.frames]
        })

    page.on('pageerror', capture_page_error)
    page.on('frameattached', lambda frame: frame_events.append({
        'event': 'attached', **frame_identity(frame)
    }))
    page.on('framenavigated', lambda frame: frame_events.append({
        'event': 'navigated', **frame_identity(frame)
    }))
    page.on('framedetached', lambda frame: frame_events.append({
        'event': 'detached', **frame_identity(frame)
    }))

    def fulfill_retry_preview(route):
        preview_requests.append(route.request.url)
        route.fulfill(
            status=200,
            headers={
                'content-type': 'application/json',
                'cache-control': 'no-store',
                'access-control-allow-origin': '*'
            },
            body=json.dumps(SOURCE_RETRY_PAYLOAD)
        )

    def capture_archive_action(request):
        if request.url.endswith('/api/action') and request.method == 'POST':
            try:
                action = json.loads(request.post_data or '{}')
            except (TypeError, ValueError):
                return
            if action.get('type') == 'draft-github-source-archive':
                action_requests.append(action)
            if action.get('type') == 'evaluate-source-archive-predicate':
                predicate_action_requests.append(action)

    def capture_archive_action_response(response):
        request = response.request
        if not request.url.endswith('/api/action') or request.method != 'POST':
            return
        try:
            action = json.loads(request.post_data or '{}')
        except (TypeError, ValueError):
            return
        if action.get('type') == 'draft-github-source-archive':
            action_response_objects.append(response)
        if action.get('type') == 'evaluate-source-archive-predicate':
            predicate_action_response_objects.append(response)

    page.route(SOURCE_RETRY_API_URL, fulfill_retry_preview)
    page.on('request', capture_archive_action)
    page.on('response', capture_archive_action_response)

    def state_snapshot():
        return page.evaluate("""async path => {
          const response = await fetch('/api/state', {
            cache: 'no-store',
            credentials: 'same-origin'
          });
          if (!response.ok) throw new Error('Retry journey state read failed: ' + response.status);
          const dto = await response.json();
          const world = dto.world;
          if (!world || !Array.isArray(world.events) ||
              !Array.isArray(world.drafts) || !Array.isArray(world.creations)) {
            throw new Error('Retry journey did not receive a complete Founder world projection.');
          }
          return {
            revision: world.revision,
            xp: world.xp,
            drafts: world.drafts.map(draft => draft.id),
            creationVersions: world.creations.map(creation => [creation.id, creation.version]),
            failures: world.events.filter(event =>
              event.type === 'source-archive-attempt-failed' && event.path === path
            ),
            retryDraftEvents: world.events.filter(event =>
              event.type === 'draft' && event.requestId
            ),
            events: world.events.map(event => ({
              id: event.id,
              type: event.type,
              requestId: event.requestId,
              requestIdDigest: event.requestIdDigest,
              actorId: event.actor?.id,
              path: event.path,
              failureCode: event.failureCode,
              draftId: event.draftId,
              publicRetentionAcknowledgementVersion: event.publicRetentionAcknowledgementVersion
            }))
          };
        }""", SOURCE_RETRY_PATH)

    try:
        page.goto(url, wait_until='networkidle')
        page.locator('#start-shared').tap()
        page.locator('#world').wait_for(state='visible')
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
        )
        page.locator('#login-button').tap()
        page.locator('#founder-name').fill('Damien')
        page.locator('#founder-key').fill('fake-browser-fixture-key-not-a-secret')
        page.locator('#verify-founder').tap()
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )

        page.locator('#places-button').tap()
        route = page.get_by_role('button', name='Walk to Source Observatory', exact=True)
        expect(route).to_be_visible()
        route.tap()
        enter_nearby_institution(
            page, 'source_observatory', 'Source Observatory', 'Source Observatory'
        )
        target_key = observatory_fixture['creationId'] + '@' + str(observatory_fixture['version'])
        target = page.locator('[data-source-observatory-target="' + target_key + '"]')
        expect(target).to_have_count(1)
        target.get_by_role('button', name='Record a source observation →', exact=True).tap()
        artifact_frames = [frame for frame in page.frames if frame != page.main_frame]
        assert len(artifact_frames) == 1 and page.locator('#artifact-frame').count() == 1, (
            'Source Observatory must open exactly one isolated artifact iframe; observed frames=' +
            json.dumps([{'name': frame.name, 'url': frame.url} for frame in artifact_frames])
        )
        artifact_frame = artifact_frames[0]
        artifact_sandbox_probe = artifact_frame.evaluate("""() => {
          let serviceWorkerAccess = 'accessible';
          try {
            void navigator.serviceWorker;
          } catch (error) {
            serviceWorkerAccess = error.name;
          }
          return {
            frameWindowName: window.name,
            frameUrl: location.href,
            origin: self.origin,
            serviceWorkerAccess,
            scripts: Array.from(document.scripts).slice(0, 12).map(script => ({
              src: script.getAttribute('src') || '',
              type: script.type || '',
              inlineLength: script.src ? 0 : script.textContent.length
            }))
          };
        }""")
        assert artifact_sandbox_probe['origin'] == 'null', (
            'The artifact must retain its opaque origin; allow-same-origin is not permitted.'
        )
        assert artifact_sandbox_probe['serviceWorkerAccess'] == 'SecurityError', (
            'A sandboxed artifact must not gain service-worker access.'
        )
        reader = page.locator('#github-source-reader')
        expect(reader).to_have_count(1)
        page.locator('#github-source-reader > summary').tap()
        page.locator('#github-source-url').fill(SOURCE_RETRY_PERMALINK)
        page.locator('#github-source-fetch').tap()
        page.wait_for_function(
            "() => document.querySelector('#github-source-status')?.textContent.includes('Retrieved ')"
        )
        assert preview_requests == [SOURCE_RETRY_API_URL], (
            'The browser preview must retrieve only the exact pinned fixture URL.'
        )
        page.locator('#github-source-save').tap()
        page.wait_for_function(
            """() => document.querySelector('[data-github-source-captures-ready="true"]') &&
              document.querySelectorAll('[data-archive-source-capture]').length === 1"""
        )
        archive_button = page.locator('[data-archive-source-capture]')
        expect(archive_button).to_have_count(1)
        before = state_snapshot()
        retry_diagnostics = {'before': before, 'artifactSandboxProbe': artifact_sandbox_probe}
        (out / 'source-archive-retry-state.json').write_text(json.dumps(retry_diagnostics, indent=2))
        assert before['creationVersions'], 'The Source Observatory fixture must remain a published world object.'

        archive_button.tap()
        page.wait_for_function(
            "() => document.querySelector('#github-source-status')?.textContent.includes('Relay preserved the exact action and request ID')",
            timeout=15000
        )
        expect(archive_button).to_be_enabled()
        pending = page.evaluate("""() => {
          const raw = localStorage.getItem('ngl.common-ground.pending-shared-action.v1');
          return raw ? JSON.parse(raw) : null;
        }""")
        assert pending and isinstance(pending.get('requestId'), str) and pending['requestId'], (
            'A transient 502 must leave a stable local Relay request receipt.'
        )
        assert pending.get('actorId') == 'damien' and pending.get('actorRole') == 'founder', (
            'The retry receipt must remain bound to the original Founder actor.'
        )
        assert set(pending['action']) == {'type', 'permalink', 'gitBlobSha', 'sha256', 'size'}, (
            'The offline pending action must contain only the immutable source reference and expected byte metadata.'
        )
        assert pending['action']['type'] == 'draft-github-source-archive'
        assert pending['action']['permalink'] == SOURCE_RETRY_PERMALINK
        assert pending['action']['gitBlobSha'] == SOURCE_FIXTURE_GIT_BLOB_SHA
        assert pending['action']['sha256'] == SOURCE_FIXTURE_SHA256
        assert pending['action']['size'] == len(SOURCE_FIXTURE_BYTES)

        after_failure = state_snapshot()
        retry_diagnostics['afterFailure'] = after_failure
        retry_diagnostics['attemptsBeforeRetry'] = (
            retry_attempts_path.read_text().strip() if retry_attempts_path.exists() else '<missing>'
        )
        (out / 'source-archive-retry-state.json').write_text(json.dumps(retry_diagnostics, indent=2))
        assert after_failure['revision'] == before['revision'] + 1, (
            'The first failed retrieval must append exactly one non-progression failure event.'
        )
        assert after_failure['xp'] == before['xp'], 'A failed retrieval must not award XP.'
        assert after_failure['drafts'] == before['drafts'], 'A failed retrieval must not create a draft.'
        assert after_failure['creationVersions'] == before['creationVersions'], (
            'A failed retrieval must not publish or create a world object.'
        )
        assert len(after_failure['failures']) == len(before['failures']) + 1
        failure = after_failure['failures'][-1]
        assert failure.get('failureCode') == 'GITHUB_SOURCE_UNAVAILABLE'
        assert failure.get('retryable') is True
        assert failure.get('actor', {}).get('id') == 'damien'
        assert failure.get('actor', {}).get('role') == 'founder'
        assert 'requestId' not in failure, 'Chronicle must retain only the request digest, not the raw retry identifier.'
        attempts_before_retry = (
            retry_attempts_path.read_text().strip() if retry_attempts_path.exists() else '<missing>'
        )
        (out / 'source-retry-fetch-attempts-before-retry.txt').write_text(attempts_before_retry)
        assert attempts_before_retry == '1', (
            'The server-side upstream fixture must have failed exactly once before retry; observed ' +
            repr(attempts_before_retry)
        )

        archive_button.tap()
        retry_wait_error = None
        try:
            # Poll only the local Relay receipt. Avoid repeated asynchronous
            # server-state reads followed by a second snapshot; inspect the
            # canonical world once after the client reconciles the pending action.
            page.wait_for_function(
                "() => localStorage.getItem('ngl.common-ground.pending-shared-action.v1') === null",
                timeout=15000
            )
        except Exception as error:
            retry_wait_error = str(error)

        after_success = state_snapshot()
        response_summaries = []
        for response in action_response_objects:
            body_error = None
            try:
                body = response.json()
            except Exception as error:
                body = {}
                body_error = str(error)
            body = body if isinstance(body, dict) else {}
            world = body.get('world') if isinstance(body.get('world'), dict) else {}
            events = world.get('events') if isinstance(world.get('events'), list) else []
            drafts = world.get('drafts') if isinstance(world.get('drafts'), list) else []
            result = body.get('result') if isinstance(body.get('result'), dict) else {}
            error_body = body.get('error') if isinstance(body.get('error'), dict) else {}
            response_summaries.append({
                'status': response.status,
                'requestId': body.get('requestId'),
                'idempotentReplay': body.get('idempotentReplay'),
                'errorCode': error_body.get('code') or body.get('code'),
                'errorMessage': error_body.get('message') or body.get('message'),
                'resultDraftId': result.get('draftId'),
                'worldRevision': world.get('revision'),
                'draftIds': [draft.get('id') for draft in drafts if isinstance(draft, dict)],
                'recentEvents': [{
                    'id': event.get('id'),
                    'type': event.get('type'),
                    'requestId': event.get('requestId'),
                    'requestIdDigest': event.get('requestIdDigest'),
                    'draftId': event.get('draftId')
                } for event in events[-4:] if isinstance(event, dict)],
                'bodyReadError': body_error
            })
        retry_diagnostics['afterSuccess'] = after_success
        retry_diagnostics['actionRequests'] = action_requests
        retry_diagnostics['actionResponses'] = response_summaries
        retry_diagnostics['retryWaitError'] = retry_wait_error
        retry_ui_state = page.evaluate("""() => {
          const status = document.querySelector('#github-source-status');
          const sheet = document.querySelector('#sheet');
          return {
            statusNodePresent: Boolean(status),
            statusText: status?.textContent ?? null,
            sheetTitle: document.querySelector('#sheet-title')?.textContent ?? null,
            sheetHidden: sheet?.hidden ?? null
          };
        }""")
        retry_diagnostics['retryStatusText'] = retry_ui_state['statusText']
        retry_diagnostics['retryStatusNodePresent'] = retry_ui_state['statusNodePresent']
        retry_diagnostics['retrySheetTitle'] = retry_ui_state['sheetTitle']
        retry_diagnostics['retrySheetHidden'] = retry_ui_state['sheetHidden']
        retry_diagnostics['pendingReceiptAfterRetry'] = page.evaluate(
            "() => localStorage.getItem('ngl.common-ground.pending-shared-action.v1') !== null"
        )
        retry_diagnostics['attemptsAfterSuccess'] = (
            retry_attempts_path.read_text().strip() if retry_attempts_path.exists() else '<missing>'
        )
        retry_diagnostics['pageErrors'] = errors
        retry_diagnostics['frameEvents'] = frame_events
        frame_tree = cdp.send('Page.getFrameTree')
        frame_tree_root = frame_tree.get('frameTree') or {}
        main_frame = frame_tree_root.get('frame') or {}
        main_frame_id = main_frame.get('id')
        def collect_frame_tree(node):
            frame_info = node.get('frame') or {}
            frame_id = frame_info.get('id')
            if frame_id:
                current = cdp_frames.setdefault(frame_id, {'id': frame_id})
                current.update({
                    'parentId': frame_info.get('parentId'),
                    'name': frame_info.get('name') or '',
                    'url': frame_info.get('url') or '',
                    'securityOrigin': frame_info.get('securityOrigin') or ''
                })
            for child in node.get('childFrames') or []:
                collect_frame_tree(child)
        collect_frame_tree(frame_tree_root)
        for exception in cdp_exceptions:
            final_frame = cdp_frames.get(exception.get('frameId')) or {}
            exception['frameNameAtEnd'] = final_frame.get('name')
            exception['frameUrlAtEnd'] = final_frame.get('url')
            exception['frameParentIdAtEnd'] = final_frame.get('parentId')
        artifact_frame_ids = [
            frame_id for frame_id, frame in cdp_frames.items()
            if frame.get('parentId') == main_frame_id
            and (frame.get('name') == 'artifact-frame' or frame.get('url') in ('about:blank', 'about:srcdoc'))
        ]
        frame_runtime_errors = {
            'mainFrameId': main_frame_id,
            'artifactFrameIds': artifact_frame_ids,
            'frames': list(cdp_frames.values()),
            'exceptions': cdp_exceptions
        }
        retry_diagnostics['frameRuntimeErrors'] = frame_runtime_errors
        (out / 'source-archive-retry-state.json').write_text(json.dumps(retry_diagnostics, indent=2))
        assert retry_wait_error is None, (
            'The same-request retry did not reconcile its local receipt: ' +
            json.dumps({
                'status': retry_diagnostics['retryStatusText'],
                'pendingReceipt': retry_diagnostics['pendingReceiptAfterRetry'],
                'responses': response_summaries,
                'after': {
                    'revision': after_success['revision'],
                    'drafts': after_success['drafts'],
                    'failures': len(after_success['failures'])
                }
            }, sort_keys=True)
        )
        assert len(response_summaries) == 2, (
            'The mobile retry must receive exactly two action responses: ' +
            json.dumps(response_summaries, sort_keys=True)
        )
        assert response_summaries[0]['status'] == 502 and response_summaries[0]['errorCode'] == 'GITHUB_SOURCE_UNAVAILABLE', (
            'The first action response must report the retained upstream outage: ' +
            json.dumps(response_summaries, sort_keys=True)
        )
        assert response_summaries[1]['status'] == 200, (
            'The retry response must succeed after the fixture recovers: ' +
            json.dumps(response_summaries, sort_keys=True)
        )
        assert response_summaries[1]['requestId'] == pending['requestId'], (
            'The successful response must reconcile the same request ID: ' +
            json.dumps(response_summaries, sort_keys=True)
        )
        assert response_summaries[1]['resultDraftId'], (
            'The successful response must identify the one private draft: ' +
            json.dumps(response_summaries, sort_keys=True)
        )
        before_event_ids = {event['id'] for event in before['events']}
        new_events = [event for event in after_success['events'] if event['id'] not in before_event_ids]
        assert after_success['revision'] - before['revision'] == len(new_events), (
            'World revision must advance exactly with retained events; before=' +
            str(before['revision']) + ', after=' + str(after_success['revision']) +
            ', new event types=' + repr([event['type'] for event in new_events])
        )
        assert len([event for event in new_events if event['type'] == 'source-archive-attempt-failed']) == 1, (
            'The first upstream failure must remain exactly once in world history.'
        )
        assert len([event for event in new_events if event['type'] == 'draft' and event.get('requestId') == pending['requestId']]) == 1, (
            'The retry must append exactly one private draft event for the same request ID.'
        )
        assert after_success['xp'] == before['xp'], (
            'Server-rechecked draft creation remains XP-neutral until explicit publication.'
        )
        assert len(after_success['drafts']) == len(before['drafts']) + 1
        assert after_success['creationVersions'] == before['creationVersions'], (
            'Creating a private draft must not publish a creation or issue publication XP.'
        )
        assert len(after_success['failures']) == len(before['failures']) + 1, (
            'Retrying the same request ID must retain the original failure exactly once.'
        )
        request_id = pending['requestId']
        assert failure.get('requestIdDigest') == hashlib.sha256(request_id.encode()).hexdigest(), (
            'The retained Chronicle failure must bind to this exact request without storing the raw identifier.'
        )
        matching_requests = [action for action in action_requests
                             if action.get('type') == 'draft-github-source-archive']
        assert len(matching_requests) == 2, (
            'The mobile UI must send one initial action and one retry, not duplicate taps or hidden requests.'
        )
        assert [action.get('requestId') for action in matching_requests] == [request_id, request_id], (
            'The Relay must reuse the exact same request ID after the transient failure.'
        )
        assert all(action.get('permalink') == SOURCE_RETRY_PERMALINK for action in matching_requests)
        assert all(not any(key in action for key in ('html', 'text', 'bytesBase64')) for action in matching_requests), (
            'The shared action must carry only the pinned source reference and expected byte receipt, never source payload bytes.'
        )
        matching_retry_drafts = [
            event for event in after_success['retryDraftEvents']
            if event.get('requestId') == request_id
        ]
        assert len(matching_retry_drafts) == 1, (
            'Exactly one retained private draft event must be bound to the retried request ID.'
        )
        new_draft_ids = set(after_success['drafts']) - set(before['drafts'])
        assert len(new_draft_ids) == 1 and matching_retry_drafts[0].get('draftId') in new_draft_ids, (
            'The idempotency event must point to the one newly retained private draft.'
        )
        attempts_after_retry = (
            retry_attempts_path.read_text().strip() if retry_attempts_path.exists() else '<missing>'
        )
        (out / 'source-retry-fetch-attempts-after-retry.txt').write_text(attempts_after_retry)
        assert attempts_after_retry == '2', (
            'The second action must re-fetch once after recovery; no hidden duplicate or third upstream attempt is allowed; observed ' +
            repr(attempts_after_retry)
        )
        assert page.evaluate(
            "() => localStorage.getItem('ngl.common-ground.pending-shared-action.v1') === null"
        ), 'A confirmed result must clear the local pending receipt.'

        if page.locator('#sheet').is_visible():
            page.locator('#sheet-close').tap()
        # A pre-upgrade predicate receipt must survive the new 428 response and
        # be explicitly reviewed before the same request ID is retried.
        legacy_predicate_request_id = 'legacy-predicate-pending-ack'
        legacy_predicate_before = state_snapshot()
        legacy_predicate_pending = {
            'requestId': legacy_predicate_request_id,
            'actorId': 'damien',
            'actorRole': 'founder',
            'action': {
                'type': 'evaluate-source-archive-predicate',
                'creationId': source_archive_fixture['creationId'],
                'version': source_archive_fixture['version'],
                'predicateKind': 'contains-literal',
                'literal': 'NGL_QUEST_BOARD_SERVER_RECHECK'
            }
        }
        page.evaluate("""pending => localStorage.setItem(
          'ngl.common-ground.pending-shared-action.v1', JSON.stringify(pending)
        )""", legacy_predicate_pending)
        page.locator('#journal-button').tap()
        assert predicate_action_requests == [], (
            'A legacy predicate receipt must not be automatically replayed before the player reviews the notice.'
        )
        expect(page.locator('#journal-acknowledge-pending-predicate')).to_be_visible()
        page.locator('#journal-acknowledge-pending-predicate').tap()
        expect(page.locator('#relay-pending-predicate-retention-ack')).to_be_visible()
        expect(page.locator('#relay-acknowledge-pending-predicate-submit')).to_be_disabled()
        legacy_predicate_review = state_snapshot()
        assert legacy_predicate_review['revision'] == legacy_predicate_before['revision']
        assert legacy_predicate_review['xp'] == legacy_predicate_before['xp']
        assert legacy_predicate_review['events'] == legacy_predicate_before['events'], (
            'Opening the acknowledgement review must not mutate the shared world.'
        )
        page.locator('#relay-pending-predicate-retention-ack').check()
        expect(page.locator('#relay-acknowledge-pending-predicate-submit')).to_be_enabled()
        page.locator('#relay-acknowledge-pending-predicate-submit').tap()
        page.wait_for_function(
            "() => localStorage.getItem('ngl.common-ground.pending-shared-action.v1') === null",
            timeout=15000
        )
        legacy_predicate_after = state_snapshot()
        legacy_predicate_events = [
            event for event in legacy_predicate_after['events']
            if event.get('requestId') == legacy_predicate_request_id
        ]
        assert legacy_predicate_after['revision'] == legacy_predicate_before['revision'] + 1
        assert legacy_predicate_after['xp'] == legacy_predicate_before['xp'], (
            'Migrating a pending predicate must remain XP-neutral.'
        )
        assert len(legacy_predicate_events) == 1
        assert len(predicate_action_requests) == 1, 'One explicit acknowledgement must send exactly one predicate action.'
        assert predicate_action_requests[0].get('requestId') == legacy_predicate_request_id
        assert predicate_action_requests[0].get('publicRetentionAcknowledgementVersion') == 'ngl.source-predicate-public-retention.v1'
        assert len(predicate_action_response_objects) == 1 and predicate_action_response_objects[0].status == 200
        assert legacy_predicate_events[0]['type'] == 'source-archive-predicate-evaluated'
        assert legacy_predicate_events[0]['publicRetentionAcknowledgementVersion'] == 'ngl.source-predicate-public-retention.v1'
        retry_diagnostics['legacyPendingPredicate'] = {
            'requestIdReused': legacy_predicate_request_id,
            'reviewReadOnly': True,
            'eventCount': len(legacy_predicate_events),
            'acknowledgementVersion': legacy_predicate_events[0]['publicRetentionAcknowledgementVersion'],
            'requestIdReused': predicate_action_requests[0].get('requestId') == legacy_predicate_request_id,
            'actionRequests': len(predicate_action_requests),
            'responseStatus': predicate_action_response_objects[0].status,
            'xpDelta': legacy_predicate_after['xp'] - legacy_predicate_before['xp']
        }
        if page.locator('#sheet').is_visible():
            page.locator('#sheet-close').tap()

        layout = page.evaluate("""() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth
        })""")
        assert layout['documentWidth'] <= layout['viewportWidth'] + 1, (
            'The retry guidance caused mobile horizontal overflow: ' + json.dumps(layout)
        )
        expected_sandbox_denial = (
            "Failed to read the 'serviceWorker' property from 'Navigator': "
            "Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag."
        )
        artifact_frame_ids = set(frame_runtime_errors['artifactFrameIds'])
        cdp_exceptions = frame_runtime_errors['exceptions']
        unexpected_page_errors = [
            error for error in errors
            if error.get('name') != 'SecurityError' or error.get('message') != expected_sandbox_denial
        ]
        unexpected_cdp_errors = [
            error for error in cdp_exceptions
            if error.get('frameId') not in artifact_frame_ids
            or (error.get('frameParentId') or error.get('frameParentIdAtEnd')) != frame_runtime_errors['mainFrameId']
            or error.get('exceptionName') != 'SecurityError'
            or error.get('message') != expected_sandbox_denial
            or (error.get('frameUrlAtException') or error.get('frameUrlAtEnd')) not in ('about:blank', 'about:srcdoc')
        ]
        assert len(artifact_frame_ids) == 1, (
            'The retry journey must retain exactly one isolated artifact frame: ' +
            json.dumps(frame_runtime_errors, sort_keys=True)
        )
        assert artifact_sandbox_probe['origin'] == 'null' and artifact_sandbox_probe['serviceWorkerAccess'] == 'SecurityError', (
            'The artifact must retain an opaque origin and deny service-worker access: ' +
            json.dumps(artifact_sandbox_probe, sort_keys=True)
        )
        assert not unexpected_page_errors and not unexpected_cdp_errors, (
            'Only the exact service-worker denial from the opaque artifact frame may be classified as a sandbox boundary event: ' +
            json.dumps({
                'pageErrors': errors,
                'cdpExceptions': cdp_exceptions,
                'unexpectedPageErrors': unexpected_page_errors,
                'unexpectedCdpErrors': unexpected_cdp_errors
            }, sort_keys=True)
        )
        assert len(errors) == len(cdp_exceptions), (
            'Every Playwright pageerror must map to one CDP exception with an execution-context/frame identity: ' +
            json.dumps({
                'pageErrors': errors,
                'frameRuntimeErrors': frame_runtime_errors,
                'frameEvents': frame_events
            }, sort_keys=True)
        )
        screenshot = out / 'source-archive-relay-retry-390.png'
        page.screenshot(path=str(screenshot), full_page=True)
        return {
            'journey': 'source-archive-relay-retry-mobile-390',
            'passed': True,
            'viewport': 390,
            'sourcePreviewRequests': len(preview_requests),
            'upstreamAttempts': int(retry_attempts_path.read_text().strip()),
            'sameRequestIdRetried': True,
            'metadataOnlyPendingReceipt': True,
            'failureEventRetained': True,
            'privateDraftDelta': 1,
            'publicationDelta': 0,
            'xpDelta': 0,
            'pendingReceiptClearedAfterSuccess': True,
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
    with tempfile.TemporaryDirectory(prefix='ngl-quest-board-mobile-') as temporary_dir:
        temporary_root = Path(temporary_dir)
        data_dir = temporary_root / 'data'
        data_dir.mkdir(mode=0o700)
        retry_attempts_path = temporary_root / 'source-retry-attempts.txt'
        process, url = launch_server(data_dir, retry_attempts_path)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=['--no-sandbox'])
                try:
                    source_archive_fixture = None
                    source_archive_failure = None
                    observatory_fixture = None
                    for width in (320, 390):
                        result = run_viewport(
                            browser, url, out, width, source_archive_fixture, source_archive_failure
                        )
                        results.append(result)
                        if width == 320:
                            source_archive_fixture = result['sourceArchiveFixture']
                            source_archive_failure = result['sourceArchiveFailure']
                        if width == 390:
                            observatory_fixture = result['observatoryPublication']
                        (out / 'results.json').write_text(json.dumps(results, indent=2))
                        print(json.dumps(result), flush=True)
                    retry_result = run_source_archive_mobile_retry(
                        browser, url, out, observatory_fixture, source_archive_fixture, retry_attempts_path
                    )
                    results.append(retry_result)
                    (out / 'results.json').write_text(json.dumps(results, indent=2))
                    print(json.dumps(retry_result), flush=True)
                    for width in (320, 390):
                        activity_stream_result = run_evidence_archive_activity_streams_mobile(
                            browser, url, out, width
                        )
                        results.append(activity_stream_result)
                        (out / 'results.json').write_text(json.dumps(results, indent=2))
                        print(json.dumps(activity_stream_result), flush=True)
                finally:
                    browser.close()
        finally:
            stop_server(process)
    print(json.dumps(results))


if __name__ == '__main__':
    main()
