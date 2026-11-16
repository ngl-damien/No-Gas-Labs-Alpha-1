"""Mobile acceptance for the actor-scoped, in-world Quest Board.

Three independent browser sessions share a repeatable Guild Dissent Circuit.
Two contributors complete two rounds while a silent current member sees the
shared quest but receives zero Deliberator participation. Character Record
inspection is read-only at 320px and 390px.
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
        # Resolve only a currently visible, correctly labelled control. The
        # previous is_visible() check followed by a separate tap raced the
        # pixel renderer hiding the secondary button during a fresh-client
        # navigation update.
        entry = page.locator(
            f'#interact-button[aria-label="{aria_label}"]:visible, '
            f'#enter-institution-button[aria-label="{aria_label}"]:visible'
        ).first
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


def assert_source_archive_objectives(page, role, proposal_progress, experiment_progress):
    proposal = page.locator(
        f'#sheet-content [data-objective-id="{role}-source-archive-moonshot"]'
    )
    expect(proposal).to_have_count(1)
    expect(proposal).to_contain_text('Ground a falsifiable Moonshot in a published Source Archive')
    expect(proposal).to_contain_text(proposal_progress)
    expect(proposal.locator('.quest-step-state')).to_have_text(
        'RECORDED' if proposal_progress == '1/1' else 'OPEN'
    )
    expect(proposal).to_contain_text('client-reported')
    expect(proposal).to_contain_text('not GitHub retrieval')

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


def publish_source_archive_fixture(page):
    # This is deliberately synthetic: it exercises the Source Archive type
    # discriminator and quest linkage without fetching or asserting a real source.
    html = (
        '<main data-ngl-source-archive="v1">'
        '<p>SOURCE ARCHIVE · CLIENT-REPORTED ORIGIN</p>'
        '<p>Source retrieval: NOT_PERFORMED</p>'
        '<p>Independent verification: NOT_PERFORMED</p>'
        '<p>Fixture only: no GitHub request or external source fetch was performed.</p>'
        '</main>'
    )
    draft = post_action(page, {
        'type': 'draft',
        'kind': 'custom',
        'title': 'Synthetic Source Archive · Quest Board acceptance fixture',
        'intent': 'NGL_GITHUB_SOURCE_ARCHIVE_V1 Synthetic mobile acceptance fixture; no GitHub source was fetched.',
        'html': html,
        'requestId': 'quest-board-source-archive-draft'
    })
    draft_id = draft.get('result', {}).get('draftId')
    assert isinstance(draft_id, str) and draft_id, 'Synthetic Source Archive draft must return its retained draft ID.'
    publication = post_action(page, {
        'type': 'publish',
        'draftId': draft_id,
        'expectedVersion': 0,
        'requestId': 'quest-board-source-archive-publish'
    })
    result = publication.get('result', {})
    assert isinstance(result.get('creationId'), str) and result['creationId'], (
        'Synthetic Source Archive publication must return its retained creation ID.'
    )
    assert result.get('version') == 1, 'The acceptance fixture must publish version 1.'
    return {
        'creationId': result['creationId'],
        'version': 1,
        'sourceRetrieval': 'NOT_PERFORMED',
        'independentVerification': 'NOT_PERFORMED',
        'fixtureOnly': True
    }


def source_archive_research_snapshot(page, actor_id, actor_role, archive_id, proposal_title, require_report):
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
      if ((version.kind ?? creation.kind) !== 'custom' ||
          typeof intent !== 'string' || !intent.startsWith('NGL_GITHUB_SOURCE_ARCHIVE_V1') ||
          typeof html !== 'string' || !html.includes('data-ngl-source-archive="v1"') ||
          !html.includes('CLIENT-REPORTED ORIGIN') ||
          !/^[a-f0-9]{64}$/.test(receiptDigest || '')) {
        throw new Error('The retained artifact does not satisfy the bounded client-reported Source Archive shape.');
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
        sourceRetrieval: 'NOT_PERFORMED',
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
        'archiveId': archive_id,
        'proposalTitle': proposal_title,
        'requireReport': require_report
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
        challenge_event_id = retained_event_id(
            witness_page, 'source-observation-challenged', 'challengeId', challenge_id,
            witness_before['viewerId']
        )
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
        accept_button.tap()
        founder_ward = founder_page.locator('#sheet-content [data-field-item-id]').filter(
            has_text='Contradiction Ward'
        )
        expect(founder_ward).to_have_count(1)
        expect(founder_ward).to_contain_text('current owner ' + founder_before['viewerId'])
        expect(founder_ward).to_contain_text('Original creator ' + witness_before['viewerId'])
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
        assert after_founder['revision'] == founder_before['revision'] + 12, (
            'Exactly twelve canonical actions should be retained: the original nine plus unequip, transfer offer and recipient acceptance.'
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
        assert len(event_summary['forges']) == 1
        assert event_summary['forges'][0]['actorId'] == witness_before['viewerId']
        assert event_summary['forges'][0]['slotId'] == 'adversarial'
        assert event_summary['forges'][0]['sourceEventId'] == challenge_event_id
        assert len(event_summary['equips']) == 1
        assert event_summary['equips'][0]['actorId'] == witness_before['viewerId']
        assert event_summary['equips'][0]['slotId'] == 'adversarial'
        assert event_summary['equips'][0]['sourceEventId'] == forge_event_id
        assert len(event_summary['unequips']) == 1
        assert event_summary['unequips'][0]['actorId'] == witness_before['viewerId']
        assert event_summary['unequips'][0]['slotId'] == 'adversarial'
        assert len(event_summary['transferOffers']) == 1
        assert event_summary['transferOffers'][0]['actorId'] == witness_before['viewerId']
        assert event_summary['transferOffers'][0]['itemEventId'] == forge_event_id
        assert event_summary['transferOffers'][0]['offerId'] == transfer_offer['offerId']
        assert event_summary['transferOffers'][0]['recipientId'] == founder_before['viewerId']
        assert event_summary['transferOffers'][0]['recipientRole'] == 'founder'
        assert len(event_summary['transfers']) == 1
        assert event_summary['transfers'][0]['actorId'] == founder_before['viewerId']
        assert event_summary['transfers'][0]['itemEventId'] == forge_event_id
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
        silent_before_board = authoritative_snapshot(silent_page)
        open_quest_board(founder_page)
        assert_board(founder_page, 'founder')
        assert_contradiction_ward_objectives(founder_page, 'founder', '0/1')
        assert_carry_forward_objective(founder_page, 'founder', '0/1')
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
        assert_circuit_progress(witness_page, 'witness', '4/4', complete=True)
        assert_circuit_round_progress(witness_page, 'witness', 2, '4/4', complete=True)
        assert_circuit_round_progress(witness_page, 'witness', 3, '0/4', complete=False)
        witness_after_board = authoritative_snapshot(witness_page)
        assert shared_world_snapshot(witness_after_board) == shared_world_snapshot(witness_before_board)

        open_quest_board(silent_page)
        assert_board(silent_page, 'witness')
        assert_contradiction_ward_objectives(silent_page, 'witness', '0/1')
        assert_carry_forward_objective(silent_page, 'witness', '0/1')
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
            'eventSummary': event_summary,
            'contradictionWardDossier': ward_dossier,
            'contradictionWardTransfer': {
                'offerId': transfer_offer['offerId'],
                'offeredBy': witness_before['viewerId'],
                'acceptedBy': founder_before['viewerId'],
                'creatorPreserved': True,
                'dossierPreservedAfterReload': founder_transfer_dossier['readOnly'],
                'senderNoLongerOwnsItem': True,
                'questCreditStayedWithChallenger': True
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
            'noXpAwarded': after_second_founder['xp'] == founder_before['xp'],
            'boardInspectionReadOnly': True,
            'characterProjectionReadOnly': True,
            'founderCharacterRecord': founder_character,
            'witnessCharacterRecord': witness_character,
            'silentMemberCharacterRecord': silent_character,
            'silentMemberReceivesNoParticipationCredit': silent_character['deliberatorRounds'] == 0,
            'pageErrors': witness_errors + silent_errors,
            'screenshots': [
                founder_screenshot.name, witness_screenshot.name, silent_screenshot.name,
                ward_dossier['screenshot'], founder_transfer_dossier['screenshot'],
                founder_character['screenshot'], witness_character['screenshot'],
                silent_character['screenshot']
            ]
        }
    finally:
        silent_context.close()
        witness_context.close()


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
        page, actor['viewerId'], role, archive['creationId'], proposal_title, False
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
        'Use the synthetic acceptance fixture only; no external source fetch or execution is performed.'
    )
    page.locator('#experiment-observation').fill(
        'The fixture does not establish GitHub origin, commit membership, authorship, source truth, or independent byte equality.'
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
    expect(page.locator('#sheet-content')).to_contain_text('independent byte equality')
    report_after = authoritative_snapshot(page)
    assert report_after['revision'] == report_before['revision'] + 1, (
        'Retaining the failed experiment attempt must append exactly one report event.'
    )
    assert report_after['xp'] == report_before['xp'], (
        'A failed self-reported experiment attempt is not XP, verification, or approval.'
    )
    research_details = source_archive_research_snapshot(
        page, actor['viewerId'], role, archive['creationId'], proposal_title, True
    )
    assert research_details['reportOutcome'] == 'failed'
    assert research_details['reportEvidenceCreationId'] == archive['creationId']
    assert research_details['reportEvidenceVersion'] == archive['version']
    assert research_details['reportIndex'] > research_details['proposalIndex'] > research_details['publicationIndex']

    page.locator('#sheet-close').tap()
    open_quest_board(page)
    final_board_before = authoritative_snapshot(page)
    assert_board(page, role)
    assert_source_archive_objectives(page, role, '1/1', '1/1')
    final_board_after = authoritative_snapshot(page)
    assert final_board_after == final_board_before, (
        'Reading the recorded Source Archive objectives must not append events or award XP.'
    )
    assert final_board_after['xp'] == chain_start['xp'], (
        'Source Archive proposal/report activity must not award XP.'
    )
    screenshot = out / ('source-archive-quest-' + role + '-' + suffix + '.png')
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        'actorRole': role,
        'actorId': actor['viewerId'],
        'archiveCreationId': archive['creationId'],
        'archiveVersion': archive['version'],
        'sourceRetrieval': 'NOT_PERFORMED',
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
        'boardInspectionReadOnly': True,
        'failureRemainsSelfReported': True,
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
        assert_source_archive_objectives(page, 'founder', '1/1', '1/1')
        after = authoritative_snapshot(page)
        assert after == before, 'A fresh Founder Quest Board inspection must remain read-only.'
        details = source_archive_research_snapshot(
            page, expected_actor_id, 'founder', archive['creationId'],
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



def run_viewport(browser, url, out, width, source_archive_fixture=None):
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
            source_archive_founder_chain = run_source_archive_quest_chain(
                page, 'founder', source_archive_fixture, out, '320'
            )
        else:
            assert source_archive_fixture and source_archive_fixture.get('fixtureOnly') is True, (
                'The 390px journey must reuse the exact Source Archive published by the 320px journey.'
            )
            source_archive_founder_chain = source_archive_research_snapshot(
                page, before['viewerId'], 'founder', source_archive_fixture['creationId'],
                'Source Archive workflow · Founder', True
            )
            assert_source_archive_objectives(page, 'founder', '1/1', '1/1')

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
            assert_source_archive_objectives(page, 'witness', '0/1', '0/1')
            witness_after = authoritative_snapshot(page)
            assert witness_after == witness_before, (
                'The Witness board is also a read-only projection of the shared world.'
            )
            page.locator('#sheet-close').tap()
            source_archive_witness_chain = run_source_archive_quest_chain(
                page, 'witness', source_archive_fixture, out, '390'
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
                'worldStateUnchangedByBoardInspection': True
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
            'sourceArchiveFixture': source_archive_fixture,
            'sourceArchiveFounderChain': source_archive_founder_chain,
            'sourceArchiveWitnessChain': source_archive_witness_chain,
            'founderFreshClientProgress': founder_fresh_client,
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
                    source_archive_fixture = None
                    for width in (320, 390):
                        result = run_viewport(browser, url, out, width, source_archive_fixture)
                        results.append(result)
                        if width == 320:
                            source_archive_fixture = result['sourceArchiveFixture']
                        (out / 'results.json').write_text(json.dumps(results, indent=2))
                        print(json.dumps(result), flush=True)
                finally:
                    browser.close()
        finally:
            stop_server(process)
    print(json.dumps(results))


if __name__ == '__main__':
    main()
