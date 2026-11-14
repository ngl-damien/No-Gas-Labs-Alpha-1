"""Actual Chromium acceptance against a disposable Node service and packaged offline file.

Requires Python Playwright plus Chromium for development only. No provider keys or public posts.
"""
import argparse
import os
import json
import hashlib
import math
import re
import select
import subprocess
import tempfile
import functools
import http.server
import threading
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect, TimeoutError as PlaywrightTimeoutError

ROOT=Path(__file__).resolve().parents[1]
KEY='fake-browser-fixture-key-not-a-secret'
SERVER="""import {createGameServer} from './game/server.mjs';
const server=await createGameServer({dataDir:process.argv[1],founderKey:'fake-browser-fixture-key-not-a-secret'});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.once('SIGTERM',()=>server.closeGame());"""


def launch_server(directory):
    process=subprocess.Popen(['node','--input-type=module','-e',SERVER,str(directory)],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if not select.select([process.stdout],[],[],15)[0]:
        process.terminate();process.wait(timeout=10)
        raise AssertionError('Disposable server failed readiness')
    line=process.stdout.readline()
    if not line: raise AssertionError(process.stderr.read())
    return process,f'http://127.0.0.1:{json.loads(line)["port"]}/'


def stop_server(process):
    if process.poll() is None:
        process.terminate()
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill();process.wait()
            raise AssertionError('Service failed graceful shutdown')
    assert process.returncode==0, 'Service process exited unsuccessfully'


INSTITUTION_ROUTE_IDS = {
    'Founder Gate': 'decision_chamber',
    'Guild Hall': 'guild_hall',
    'Evidence Archive': 'evidence_archive',
    'Source Observatory': 'source_observatory',
    'Quest Board': 'quest_board',
    'Polymath Academy': 'academy',
    'Moonshot Field': 'moonshot_field',
    'Forge': 'forge',
    'Combat Yard': 'combat_yard',
    'The Commons at TownSquare': 'town-square'
}


def wait_for_nearby_institution(page, place_id, timeout=30000):
    page.wait_for_function(
        """expected => {
            const world = document.querySelector('#world');
            const sheet = document.querySelector('#sheet');
            const enterButton = document.querySelector('#enter-institution-button');
            const primaryButton = document.querySelector('#interact-button');
            const separateEntry = enterButton && !enterButton.hidden &&
                enterButton.getAttribute('aria-label')?.startsWith('Enter ') === true;
            return world?.dataset.nearbyInstitutionId === expected &&
                sheet?.hidden === true &&
                (separateEntry || primaryButton?.getAttribute('aria-label')?.startsWith('Enter ') === true);
        }""",
        arg=place_id,
        timeout=timeout
    )


def enter_nearby_institution(page, place_id, timeout=30000):
    expected_name = next((name for name, candidate in INSTITUTION_ROUTE_IDS.items()
                          if candidate == place_id), None)
    if expected_name is None:
        raise AssertionError(f'No institution name is registered for {place_id!r}')

    deadline = time.monotonic() + timeout / 1000
    last_state = None
    while time.monotonic() < deadline:
        last_state = page.evaluate("""expected => {
            const world = document.querySelector('#world');
            const sheet = document.querySelector('#sheet');
            const separate = document.querySelector('#enter-institution-button');
            const primary = document.querySelector('#interact-button');
            const visible = element => Boolean(element && !element.hidden &&
                element.getClientRects().length &&
                getComputedStyle(element).visibility !== 'hidden' &&
                getComputedStyle(element).pointerEvents !== 'none');
            return {
                nearbyInstitutionId: world?.dataset.nearbyInstitutionId ?? null,
                sheetHidden: sheet?.hidden === true,
                modalOpen: document.body.classList.contains('modal-open'),
                separateVisible: visible(separate),
                separateId: separate?.dataset.institutionId ?? null,
                primaryVisible: visible(primary),
                primaryLabel: primary?.getAttribute('aria-label') ?? null
            };
        }""", place_id)

        ready = last_state.get('nearbyInstitutionId') == place_id and \
            last_state.get('sheetHidden') and not last_state.get('modalOpen')
        if ready and last_state.get('separateVisible') and last_state.get('separateId') == place_id:
            try:
                page.locator('#enter-institution-button').click(timeout=500)
                return
            except PlaywrightTimeoutError:
                # The nearest entity can change between the DOM snapshot and
                # Playwright's actionability check. Re-read both explicit routes.
                pass
        # Some institutions use a public display label that differs from the
        # route name (for example, TownSquare · Institution Records). The exact
        # nearbyInstitutionId above binds this generic Enter control to the target.
        primary_label = last_state.get('primaryLabel')
        if ready and last_state.get('primaryVisible') and \
                isinstance(primary_label, str) and primary_label.startswith('Enter '):
            try:
                page.locator('#interact-button').click(timeout=500)
                return
            except PlaywrightTimeoutError:
                pass
        page.wait_for_timeout(100)

    raise AssertionError(
        f'No stable explicit entry control remained available for {expected_name}: {last_state}'
    )


def walk_to_location(page, name, timeout=30000, enter=True):
    page.bring_to_front()
    page.get_by_role('button', name=f'Walk to {name}', exact=True).click()
    place_id = INSTITUTION_ROUTE_IDS.get(name)
    if place_id is None or not enter:
        return
    try:
        wait_for_nearby_institution(page, place_id, timeout)
    except Exception as error:
        diagnostics = page.evaluate("""() => {
            let playerPosition = null;
            try { playerPosition = JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')); } catch {}
            const world = document.querySelector('#world');
            return {
                visibilityState: document.visibilityState,
                hasFocus: document.hasFocus(),
                modeLabel: document.querySelector('#mode-label')?.textContent ?? null,
                connectionState: document.querySelector('#connection-dot')?.dataset.connectionState ?? null,
                nearbyInstitutionId: world?.dataset.nearbyInstitutionId ?? null,
                nearbyNpcRole: world?.dataset.nearbyNpcRole ?? null,
                nearbyPlayerName: world?.dataset.nearbyPlayerName ?? null,
                interactLabel: document.querySelector('#interact-button')?.getAttribute('aria-label') ?? null,
                enterInstitutionLabel: document.querySelector('#enter-institution-button')?.getAttribute('aria-label') ?? null,
                enterInstitutionHidden: document.querySelector('#enter-institution-button')?.hidden ?? null,
                modalOpen: document.body.classList.contains('modal-open'),
                playerPosition
            };
        }""")
        raise AssertionError(f'Player did not reach the explicit entry prompt for {name}: {diagnostics}') from error
    enter_nearby_institution(page, place_id, timeout)


def install_gate_fixture(page, *, offline_initial=False, advance_head=False):
    state={
        'offline':offline_initial,'advance_head':advance_head,
        'detailCalls':0,'checkShas':[],'methods':[],
        'headA':'a'*40,'headB':'b'*40
    }
    base='https://api.github.com/repos/ngl-damien/No-Gas-Labs-Alpha-1'
    def handle(route):
        request=route.request
        state['methods'].append(request.method)
        if state['offline']:
            route.abort('internetdisconnected')
            return
        if request.method!='GET':
            route.fulfill(status=405,content_type='application/json',body=json.dumps({'message':'GET only'}))
            return
        path=request.url.split('?',1)[0]
        if path==base+'/pulls':
            payload=[{
                'number':428,'title':'Combat Yard integration fixture','draft':True,'state':'open',
                'head':{'ref':'game/founder-gate-exact-head-decision-path-20261109-run10'},
                'base':{'ref':'main'},'html_url':'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/428'
            }]
        elif path==base+'/issues':
            payload=[]
        elif path==base+'/actions/runs':
            payload={'workflow_runs':[]}
        elif path==base+'/pulls/428':
            state['detailCalls']+=1
            sha=state['headA'] if not state['advance_head'] or state['detailCalls']==1 else state['headB']
            payload={
                'number':428,'title':'Combat Yard integration fixture',
                'body':'Disposable browser fixture. No repository write or authorization is represented.',
                'state':'open','draft':True,
                'base':{'ref':'main','sha':'c'*40},
                'head':{'ref':'game/founder-gate-exact-head-decision-path-20261109-run10','sha':sha},
                'html_url':'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/428'
            }
        elif path==base+'/pulls/428/files':
            payload=[{'filename':'game/github-decision-gate.mjs'},{'filename':'test/github-decision-gate.test.mjs'}]
        elif path==base+'/commits/'+state['headA']+'/check-runs':
            state['checkShas'].append(state['headA'])
            payload={'total_count':1,'check_runs':[{
                'name':'Android Alpha-1','status':'completed','conclusion':'failure',
                'html_url':'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42648582393'
            }]}
        elif path==base+'/commits/'+state['headA']+'/status':
            payload={'state':'failure','total_count':1,'statuses':[{
                'context':'Android Alpha-1','state':'failure','description':'Instrumentation failed.'
            }]}
        elif path==base+'/commits/'+state['headB']+'/check-runs':
            state['checkShas'].append(state['headB'])
            payload={'total_count':1,'check_runs':[{
                'name':'Browser Acceptance','status':'in_progress','conclusion':None,
                'html_url':'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42648582274'
            }]}
        elif path==base+'/commits/'+state['headB']+'/status':
            payload={'state':'pending','total_count':1,'statuses':[{
                'context':'Browser Acceptance','state':'pending','description':'Browser acceptance is running.'
            }]}
        else:
            route.fulfill(status=404,content_type='application/json',body=json.dumps({'message':'not found'}))
            return
        route.fulfill(status=200,content_type='application/json',body=json.dumps(payload))
    page.route(base+'/**',handle)
    return state


def close_sheet(page):
    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').click()
    # The sheet can be hidden before its backdrop stops intercepting pointer
    # events. Wait for both layers before starting the next world interaction.
    expect(page.locator('#sheet')).to_be_hidden()
    expect(page.locator('#sheet-backdrop')).to_be_hidden()


def draft(page,kind,title):
    close_sheet(page)
    page.locator('#make-button').click()
    page.locator('#command-input').fill(title)
    page.locator('#recipe-select').select_option(kind)
    # The visible title field is part of the product rather than a test-only hook.
    if page.locator('#creation-title').count():page.locator('#creation-title').fill(title)
    page.locator('#draft-button').click()
    page.locator('#publish-button').wait_for()


def basic(page,url,out,label):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    gate_fixture=install_gate_fixture(page,offline_initial=True,advance_head=True) if label=='phone' else None
    page.goto(url,wait_until='networkidle')
    page.get_by_role('button',name='Play your world',exact=True).click()
    page.locator('#world').wait_for(state='visible')
    expect(page.locator('#world')).to_have_attribute('data-world-renderer', 'pixel-v1')
    expect(page.locator('#world')).to_have_attribute('data-active-quest-target', 'location:workbench')
    expect(page.locator('#world')).to_have_attribute('data-active-quest-target-label', 'The Making Bench')
    expect(page.locator('#world')).to_have_attribute('aria-label', re.compile('Active quest target: The Making Bench'))
    page.wait_for_function("()=>document.querySelector('#mode-label').textContent.toLowerCase().includes('private')")
    character=page.locator('#character-button')
    expect(character).to_be_visible()
    expect(character).to_have_attribute('aria-label',re.compile('level 1',re.I))
    character.click()
    expect(page.locator('#sheet-title')).to_have_text('Character & field record')
    expect(page.locator('#sheet')).to_contain_text('Level 1')
    expect(page.locator('#sheet')).to_contain_text('Questkeeper')
    close_sheet(page)
    if gate_fixture:
        private_world_before=page.evaluate("localStorage.getItem('ngl.common-ground.v2')")
        private_xp_before=page.locator('#xp-count').text_content()
        page.locator('#places-button').click()
        walk_to_location(page, "Founder Gate")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Decision Chamber'&&!document.querySelector('#sheet').hidden")
        offline_gate=page.locator('[data-github-decision-gate]')
        expect(offline_gate).to_be_visible()
        expect(offline_gate).to_contain_text('0/3 GitHub sources available')
        expect(offline_gate.locator('.github-gate__unavailable')).to_have_count(4)
        offline_refresh=offline_gate.get_by_role('button',name='Refresh live state',exact=True)
        expect(offline_refresh).to_be_enabled()
        offline_refresh.click()
        expect(offline_gate).to_contain_text('0/3 GitHub sources available')
        expect(offline_refresh).to_be_enabled()
        assert page.evaluate("localStorage.getItem('ngl.common-ground.v2')")==private_world_before
        assert page.locator('#xp-count').text_content()==private_xp_before
        close_sheet(page)
    expect(page.locator('[data-objective-id="founder-first-place"]')).to_contain_text('OPEN')
    expect(page.locator('[data-objective-id="founder-first-place"]')).to_contain_text('0/1')
    first_objective=page.locator('[data-objective-id="founder-first-place"]')
    go_to_first=first_objective.get_by_role('button',name='Go do this →',exact=True)
    expect(go_to_first).to_be_visible()
    go_to_first.click()
    expect(page.locator('#sheet-title')).to_have_text('Give an idea a place.')
    expect(page.locator('#creation-count')).to_have_text('0')
    expect(page.locator('#xp-count')).to_have_text('0')
    close_sheet(page)
    page.keyboard.down('ArrowRight');page.wait_for_timeout(300);page.keyboard.up('ArrowRight')
    draft(page,'comic','The real comic lives here')
    page.locator('#preview-button').click()
    frame=page.frame_locator('#artifact-frame')
    # Wait for the recipe script to attach its handlers before interacting in mobile emulation.
    expect(frame.locator('html')).to_have_attribute('data-ngl-ready', 'true')
    # The parent portal may still cover the child until its painted message arrives.
    expect(page.locator('#artifact-frame')).to_have_attribute('aria-busy', 'false')
    # This marker is emitted after the parent frame following cover removal.
    expect(page.locator('#artifact-frame')).to_have_attribute('data-ngl-input-ready', 'true')
    frame.locator('img').first.wait_for()
    assert frame.locator('img').first.evaluate('(img)=>img.decode().then(()=>img.naturalWidth>0)'), 'Original comic did not load'
    page.locator('#portal-close').click();page.locator('#publish-button').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('1')")
    expect(page.locator('[data-objective-id="founder-first-place"]')).to_contain_text('RECORDED')
    expect(page.locator('#world')).to_have_attribute('data-active-quest-target', 'location:relay')
    expect(page.locator('#world')).to_have_attribute('data-active-quest-target-label', 'The Relay')
    if page.evaluate('window.innerWidth') < 600:
        expect(page.locator('#world')).to_have_attribute('data-quest-compass', 'offscreen')
    else:
        expect(page.locator('#world')).to_have_attribute('data-quest-compass', 'onscreen')
    evidence = page.locator('[data-objective-id="founder-first-place"] details.quest-evidence')
    expect(evidence).to_have_count(1)
    expect(evidence.locator('summary')).to_have_text('Inspect retained evidence')
    evidence.locator('summary').click()
    expect(evidence).to_contain_text('PUBLISH')
    expect(evidence).to_contain_text('version 1')
    expect(evidence).to_contain_text(re.compile(r'at \d{4}-\d{2}-\d{2}T[0-9:.]+Z'))
    expect(evidence.locator('code')).to_contain_text('event-')
    evidence.get_by_role('button', name='Open retained version 1 →', exact=True).click()
    expect(page.locator('#version-select')).to_have_value('1')
    close_sheet(page)
    draft(page,'loom','A sentence that sings')
    page.locator('#preview-button').click()
    frame=page.frame_locator('#artifact-frame')
    # The iframe DOM can appear before its inline recipe script finishes on a phone viewport.
    expect(frame.locator('html')).to_have_attribute('data-ngl-ready', 'true')
    # Child readiness does not mean the parent has removed its input-blocking cover.
    expect(page.locator('#artifact-frame')).to_have_attribute('aria-busy', 'false')
    # This marker is emitted after the parent frame following cover removal.
    expect(page.locator('#artifact-frame')).to_have_attribute('data-ngl-input-ready', 'true')
    frame.locator('#score').fill('café 🌍 🧶')
    frame.locator('#play').click()
    expect(frame.locator('#status')).to_have_text('Playing 8 Unicode notes.')
    assert frame.locator('#threads span').count()==8, 'Unicode mapping did not use codepoints'
    frame.locator('#stop').click()
    page.locator('#portal-close').click();page.locator('#publish-button').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('2')")
    expect(page.locator('[data-objective-id="founder-second-place"]')).to_contain_text('RECORDED')
    close_sheet(page)
    draft(page,'observatory','A falsifiable research notebook')
    page.locator('#preview-button').click()
    frame=page.frame_locator('#artifact-frame')
    expect(frame.locator('html')).to_have_attribute('data-ngl-ready', 'true')
    expect(page.locator('#artifact-frame')).to_have_attribute('aria-busy', 'false')
    expect(page.locator('#artifact-frame')).to_have_attribute('data-ngl-input-ready', 'true')
    frame.locator('#claim').fill('The model says the bridge is open.')
    frame.locator('#source-kind').select_option('model-assertion')
    frame.locator('#source').fill('Model output only; no source retrieved.')
    frame.locator('#falsifier').fill('A direct inspection finds it closed.')
    frame.locator('#uncertainty').fill('No independent observation.')
    frame.locator('#next-test').fill('Inspect the bridge.')
    frame.locator('#add-observation').click()
    expect(frame.locator('#observations article')).to_have_count(1)
    with page.expect_download() as notes_download:
        frame.locator('#download').click()
    notes_path=notes_download.value.path()
    notes=json.loads(Path(notes_path).read_text())
    assert notes['schema']=='ngl.source-observatory.v2'
    assert notes['assurance']['sourceRetrieval']=='NOT_PERFORMED'
    assert notes['assurance']['independentVerification']=='NOT_PERFORMED'
    assert notes['assurance']['modelAssertions']=='LEADS_ONLY'
    assert notes['observations'][0]['sourceKind']=='model-assertion'
    page.locator('#portal-close').click();page.locator('#publish-button').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('3')")
    expect(page.locator('#xp-count')).to_have_text('300')
    close_sheet(page)
    page.locator('#places-button').click()
    walk_to_location(page, "Guild Hall")
    page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'")
    expect(page.locator('#contradiction-clerk-npc')).to_contain_text('BOUNDED ADVERSARY')
    expect(page.locator('#contradiction-clerk-npc')).to_contain_text('No AI/provider call occurs')
    page.get_by_role('button',name='Challenge The real comic lives here · v1 →',exact=True).click()
    expect(page.locator('#sheet-title')).to_have_text('The real comic lives here')
    expect(page.locator('#contradiction-form')).to_be_visible()
    page.locator('#contradiction-claim').fill('The receipt proves the claim is true.')
    page.locator('#contradiction-source').fill('The retained version bytes and cited source page.')
    page.locator('#contradiction-falsifier').fill('A reproducible counterexample or contradictory source.')
    page.locator('#contradiction-unknown').fill('Whether the source supports the exact wording; inspect the passage.')
    page.locator('#contradiction-submit').click()
    expect(page.locator('#creation-notes')).to_contain_text('CONTRADICTION CLERK · STRUCTURED CHALLENGE')
    expect(page.locator('#creation-notes')).to_contain_text('REPORT ONLY — NOT A VERDICT')
    expect(page.locator('#xp-count')).to_have_text('300')
    close_sheet(page)
    page.locator('#places-button').click()
    walk_to_location(page, "Evidence Archive")
    page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
    expect(page.locator('#sheet')).to_contain_text('CONTRADICTION CLERK · STRUCTURED CHALLENGE')
    expect(page.locator('#sheet')).to_contain_text('REPORT ONLY — NOT A VERDICT')
    expect(page.locator('#xp-count')).to_have_text('300')
    target_select=page.locator('[data-source-observation-import-target]')
    target_value=target_select.evaluate("el=>Array.from(el.options).find(option=>option.value)?.value")
    assert target_value, 'Evidence Archive did not offer the retained Source Observatory version'
    assert notes['observations'][0]['claim']=='The model says the bridge is open.'
    assert notes['observations'][0]['source']=='Model output only; no source retrieved.'
    target_select.select_option(target_value)
    page.locator('[data-source-observation-import-file]').set_input_files(notes_path)
    expect(page.locator('[data-source-observation-import-confirm]')).to_be_enabled()
    page.locator('[data-source-observation-import-confirm]').click()
    expect(page.locator('[data-source-observation-card]')).to_have_count(1)
    expect(page.locator('#sheet')).to_contain_text('Model assertions are leads only, not evidence.')
    expect(page.locator('#xp-count')).to_have_text('300')
    # Re-importing the same actor/version/note is idempotent and adds no second world event.
    target_select=page.locator('[data-source-observation-import-target]')
    target_value=target_select.evaluate("el=>Array.from(el.options).find(option=>option.value)?.value")
    target_select.select_option(target_value)
    page.locator('[data-source-observation-import-file]').set_input_files(notes_path)
    expect(page.locator('[data-source-observation-import-confirm]')).to_be_enabled()
    page.locator('[data-source-observation-import-confirm]').click()
    expect(page.locator('[data-source-observation-card]')).to_have_count(1)
    close_sheet(page)
    page.locator('#character-button').click()
    expect(page.locator('#sheet')).to_contain_text('Source Recorder')
    close_sheet(page)
    expect(page.locator('[data-objective-id="founder-source-observation"]')).to_contain_text('RECORDED')
    expect(page.locator('#xp-count')).to_have_text('300')
    close_sheet(page)
    page.screenshot(path=str(out/f'{label}.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
    page.reload(wait_until='networkidle');page.locator('#start-private').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('3')")
    saved_position=page.evaluate("JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))")
    assert saved_position and saved_position['schema']=='ngl.player-position.v1', 'Private player position was not saved across reload'
    assert saved_position['x']>180, f'Expected the moved player position to be restored, got {saved_position}'
    gate_result=None
    if gate_fixture:
        private_world_bytes=page.evaluate("localStorage.getItem('ngl.common-ground.v2')")
        gate_fixture['offline']=False
        page.reload(wait_until='networkidle')
        page.locator('#start-shared').click()
        page.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        page.locator('#login-button').click()
        page.locator('#founder-key').fill(KEY)
        page.locator('#verify-founder').click()
        page.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Founder')")
        shared_before=page.evaluate("""async()=>{const r=await fetch('/api/state',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error('Shared state unavailable: '+r.status);return (await r.json()).world;}""")
        page.locator('#places-button').click()
        walk_to_location(page, "Founder Gate")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Decision Chamber'&&!document.querySelector('#sheet').hidden")
        gate=page.locator('[data-github-decision-gate]')
        expect(gate).to_be_visible()
        expect(gate).to_contain_text('3/3 GitHub sources available')
        page.locator('[data-investigate-kind="pull"]').click()
        decision_path=gate.locator('[data-exact-head-checks="true"]')
        expect(decision_path).to_have_attribute('data-decision-state','blocked')
        expect(decision_path).to_contain_text('Android Alpha-1')
        expect(gate.locator('[data-gate-choice="recheck-current-head"]')).to_be_visible()
        gate.locator('[data-gate-choice="recheck-current-head"]').click()
        expect(decision_path).to_have_attribute('data-decision-state','waiting')
        expect(decision_path).to_contain_text('HEAD CHANGED')
        expect(decision_path).to_contain_text(gate_fixture['headB'])
        assert gate_fixture['detailCalls']==2
        assert gate_fixture['checkShas']==[gate_fixture['headA'],gate_fixture['headB']]
        assert gate_fixture['methods'] and set(gate_fixture['methods'])=={'GET'}
        gate.locator('[data-gate-choice="back-to-doors"]').click()
        expect(gate.locator('.github-gate__detail')).to_contain_text('Choose another record from the three doors above')
        shared_after=page.evaluate("""async()=>{const r=await fetch('/api/state',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error('Shared state unavailable: '+r.status);return (await r.json()).world;}""")
        assert shared_after['revision']==shared_before['revision']
        assert [event['id'] for event in shared_after['events']]==[event['id'] for event in shared_before['events']]
        assert shared_after['xp']==shared_before['xp']
        assert page.evaluate("localStorage.getItem('ngl.common-ground.v2')")==private_world_bytes
        close_sheet(page)
        gate_result={
            'privateOfflineSources':'0/3; refresh retryable; no private world or XP mutation',
            'sharedExactHead':'failure on old SHA -> recheck new SHA -> WAIT; old checks discarded',
            'readOnly':True,'checkShas':gate_fixture['checkShas'],
            'sharedWorldRevisionUnchanged':True,'sharedWorldXpUnchanged':True
        }
    assert not errors,errors
    result={'journey':label,'passed':True,'errors':errors}
    if gate_result: result['founderGate']=gate_result
    return result


def visit(page,title):
    close_sheet(page);page.locator('#places-button').click()
    page.get_by_role('button',name=f'Open {title}',exact=True).click()


def phone_toolbar_layout(browser,url,width):
    context=browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True)
    page=context.new_page()
    try:
        page.goto(url,wait_until='networkidle')
        page.locator('#start-private').click()
        page.locator('#world').wait_for(state='visible')
        expect(page.locator('#world')).to_have_attribute('data-world-renderer', 'pixel-v1')
        toolbar=page.locator('.tool-buttons')
        expect(toolbar).to_be_visible()
        buttons=toolbar.locator(':scope > button')
        assert buttons.count()==5, f'Expected five play controls at {width}px, got {buttons.count()}'
        bounds=toolbar.bounding_box()
        assert bounds and bounds['x']>=0 and bounds['x']+bounds['width']<=width, f'Toolbar escapes viewport at {width}px: {bounds}'
        for index in range(buttons.count()):
            target=buttons.nth(index)
            expect(target).to_be_visible()
            box=target.bounding_box()
            assert box and box['width']>=44 and box['height']>=44, f'Control {index} is too small to tap at {width}px: {box}'
            assert box['x']>=0 and box['x']+box['width']<=width, f'Control {index} is clipped at {width}px: {box}'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'Horizontal overflow at {width}px'
        character=page.locator('#character-button')
        character.click()
        expect(page.locator('#sheet-title')).to_have_text('Character & field record')
        close_sheet(page)
        return {'journey':f'phone-toolbar-{width}px','passed':True,'controls':5,'minimum_target':44}
    finally:
        context.close()


def institutional_locations(browser,url,out):
    errors=[]
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
    page=context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.goto(url,wait_until='networkidle')
        page.locator('#start-private').click()
        page.locator('#world').wait_for(state='visible')
        expect(page.locator('#world')).to_have_attribute('data-world-renderer', 'pixel-v1')
        cases=[
            ('The Relay','Carry the question.','Draft a portable request →'),
            ('River of Receipts','The river remembers bytes.','Build a source observatory →'),
            ('The Long View','Make room for another voice.','Make a first place to preserve →'),
            ('The Unfinished','Unfinished is a useful state.','Give the recovered comic a home →')
        ]
        for place,title,label in cases:
            close_sheet(page)
            page.locator('#places-button').click()
            walk_to_location(page, place)
            page.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg=title)
            expect(page.locator('#sheet .primary-button')).to_have_text(label)
            assert page.locator('#creation-count').text_content()=='0', 'Selecting a location must not create an artifact'
            assert page.locator('#xp-count').text_content()=='0', 'Selecting a location must not award XP'
        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Guild Hall")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'")
        expect(page.locator('#contradiction-clerk-npc')).to_contain_text('BOUNDED ADVERSARY')
        expect(page.locator('#contradiction-clerk-npc')).to_contain_text('No published artifact is available to challenge yet')
        expect(page.locator('#contradiction-clerk-npc button')).to_have_count(0)
        assert page.locator('#creation-count').text_content()=='0', 'The bounded adversary must not invent a published target'
        assert page.locator('#xp-count').text_content()=='0', 'Opening the bounded adversary must not award XP'
        close_sheet(page)
        for role,name,location in [
            ('archivist','Hostile Archivist','Evidence Archive'),
            ('adversary','Adversary','Evidence Archive'),
            ('synthesizer','Synthesis Clerk','Guild Hall'),
            ('tutor','Polymath Tutor','Polymath Academy'),
            ('contradiction-clerk','The Contradiction Clerk','Guild Hall')
        ]:
            control=page.locator(f'[data-guild-npc-control="{role}"]')
            expect(control).to_have_count(1)
            page.wait_for_function("()=>!document.body.classList.contains('modal-open')&&document.querySelector('#play-ui')?.hidden===false")
            expect(control).to_be_enabled()
            snapshot = "() => {const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return {revision:value.revision,events:value.events.map(event=>({id:event.id,type:event.type,locationId:event.locationId,actorId:event.actor?.id})),actorId:localStorage.getItem('ngl.common-ground.v2.actor'),xp:value.xp}}"
            before=page.evaluate(snapshot)
            control.evaluate("(button)=>button.click()")
            page.wait_for_function("(role)=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl===role&&button.dataset.guildNpcAction==='talk')",arg=role)
            expect(control).to_have_attribute('data-guild-npc-action','talk')
            after_approach=page.evaluate(snapshot)
            previous_ids={event['id'] for event in before['events']}
            travel_events=[event for event in after_approach['events'] if event['id'] not in previous_ids]
            allowed_guides={'relay','river','overlook','ruins'}
            assert all(event['type']=='discover' and event['locationId'] in allowed_guides and event['actorId']==before['actorId'] for event in travel_events), f'Approaching {name} may record only actor-local guide discoveries: {travel_events}'
            assert len({event['locationId'] for event in travel_events})==len(travel_events), f'Approaching {name} must not repeat a guide discovery: {travel_events}'
            assert after_approach['revision']==before['revision']+len(travel_events), f'Approaching {name} changed revision beyond retained guide discoveries'
            assert after_approach['xp']==before['xp'], f'Approaching {name} must not award XP'
            control.evaluate("(button)=>button.click()")
            page.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg=location)
            if role=='contradiction-clerk':
                role_card=page.locator('[data-local-npc-role="contradiction-clerk"]')
                expect(role_card).to_contain_text('BOUNDED ADVERSARY')
                expect(role_card).to_contain_text('No AI/provider call occurs')
                expect(role_card).to_contain_text('FIXED LOCAL PROTOCOL')
            else:
                role_card=page.locator(f'[data-collaborator-role="{role}"]')
            expect(role_card).to_be_visible()
            expect(role_card).to_be_focused()
            after_talk=page.evaluate(snapshot)
            assert after_talk==after_approach, f'Interacting with {name} must not create a canonical event, revision, or XP'
            assert page.locator('#creation-count').text_content()=='0', f'{name} must not create an artifact'
            assert page.locator('#xp-count').text_content()=='0', f'{name} must not award XP'
            close_sheet(page)
        moonshot_objective=page.locator('[data-objective-id="founder-moonshot-proposal"]')
        expect(moonshot_objective).to_contain_text('OPEN')
        moonshot_objective.get_by_role('button',name='Go do this →',exact=True).click()
        wait_for_nearby_institution(page, 'moonshot_field')
        before_entry = page.evaluate("""async () => {
            const response = await fetch('/api/state', {cache:'no-store', credentials:'same-origin'});
            if (!response.ok) throw new Error('Moonshot entry state read failed: ' + response.status);
            const state = await response.json();
            return {revision:state.world.revision,events:state.world.events.map(event=>event.id),xp:state.world.xp};
        }""")
        enter_nearby_institution(page, 'moonshot_field')
        after_entry = page.evaluate("""async () => {
            const response = await fetch('/api/state', {cache:'no-store', credentials:'same-origin'});
            if (!response.ok) throw new Error('Moonshot post-entry state read failed: ' + response.status);
            const state = await response.json();
            return {revision:state.world.revision,events:state.world.events.map(event=>event.id),xp:state.world.xp};
        }""")
        assert after_entry == before_entry, 'Entering Moonshot Field must not create an event, revision, or XP.'
        page.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Moonshot Field')
        expect(page.locator('#propose-moonshot')).to_be_visible()
        page.locator('#moonshot-title').fill('Can this claim be falsified?')
        page.locator('#moonshot-hypothesis').fill('The retained claim holds under its stated conditions.')
        page.locator('#moonshot-falsifier').fill('A reproducible counterexample appears under those conditions.')
        page.locator('#moonshot-evidence').fill('Independent observation and the exact source bytes.')
        page.locator('#propose-moonshot').click()
        expect(page.locator('#sheet')).to_contain_text('PROPOSED · NOT EXECUTED')
        expect(page.locator('#sheet')).to_contain_text('A reproducible counterexample appears')
        expect(page.locator('[data-objective-id="founder-moonshot-proposal"]')).to_contain_text('RECORDED')
        close_sheet(page)
        proposal_objective=page.locator('[data-objective-id="founder-moonshot-proposal"]')
        proposal_objective.locator('details.quest-evidence summary').click()
        proposal_link=proposal_objective.get_by_role('button',name='Inspect moonshot proposal →',exact=True)
        expect(proposal_link).to_be_visible()
        proposal_link.click()
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Moonshot Field' && document.querySelector('.moonshot-card.is-selected')?.textContent.includes('Can this claim be falsified?')")
        assert page.locator('.moonshot-card.is-selected').evaluate('(element)=>element===document.activeElement'), 'Quest evidence should navigate to and focus the exact retained proposal'
        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "moonshot proposal: Can this claim be falsified?")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Moonshot Field' && document.querySelector('.moonshot-card.is-selected')?.textContent.includes('Can this claim be falsified?')")
        expect(page.locator('.moonshot-card.is-selected')).to_contain_text('Can this claim be falsified?')
        assert page.locator('.moonshot-card.is-selected').evaluate('(element)=>element===document.activeElement'), 'Walking to a moonshot object should focus its retained proposal card'
        experiment_objective=page.locator('[data-objective-id="founder-experiment-report"]')
        expect(experiment_objective).to_contain_text('OPEN')
        page.get_by_role('button',name='Record an experiment attempt →',exact=True).click()
        page.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Record an attempt.')
        page.locator('#experiment-procedure').fill('Compare the claim against the stated condition.')
        page.locator('#experiment-observation').fill('The attempt contradicted the prediction.')
        page.locator('#experiment-outcome').select_option('contradicts')
        page.locator('#report-experiment').click()
        expect(page.locator('#sheet')).to_contain_text('SELF-REPORTED · NOT ADJUDICATED')
        expect(page.locator('#sheet')).to_contain_text('The attempt contradicted the prediction.')
        expect(page.locator('[data-objective-id="founder-experiment-report"]')).to_contain_text('RECORDED')
        assert page.locator('#creation-count').text_content()=='0', 'A moonshot and report must not create a published artifact'
        assert page.locator('#xp-count').text_content()=='0', 'A moonshot and report must not award XP'
        # Add three more real, self-reported attempts so the Archivist receives a
        # bounded three-activity slice and must disclose the first omitted event ID.
        for index in range(3):
            page.get_by_role('button',name='Record an experiment attempt →',exact=True).click()
            page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Record an attempt.'")
            page.locator('#experiment-procedure').fill(f'Repeat the stated procedure for scope fixture {index+1}.')
            page.locator('#experiment-observation').fill(f'Attempt {index+1} did not produce a controlled independent measurement.')
            page.locator('#experiment-outcome').select_option('inconclusive')
            page.locator('#report-experiment').click()
            page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Moonshot Field'")
        assert page.locator('#xp-count').text_content()=='0', 'Additional self-reported attempts must not award XP'
        close_sheet(page)
        guild_response_quest=page.locator('[data-objective-id="founder-guild-response"]')
        expect(guild_response_quest).to_contain_text('OPEN')
        expect(guild_response_quest.get_by_role('button',name='Go do this →',exact=True)).to_be_visible()
        quest_route_before=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return {revision:value.revision,eventIds:value.events.map(event=>event.id),xp:value.xp}}")
        guild_response_quest.get_by_role('button',name='Go do this →',exact=True).click()
        page.wait_for_function("()=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl==='archivist'&&button.dataset.guildNpcAction==='talk')")
        expect(page.locator('#sheet')).to_be_hidden()
        quest_route_after=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return {revision:value.revision,eventIds:value.events.map(event=>event.id),xp:value.xp}}")
        assert quest_route_after==quest_route_before, 'Following the Guild response quest to its NPC must not create an event, revision, or XP'
        archivist_control=page.locator('[data-guild-npc-control="archivist"]')
        expect(archivist_control).to_have_attribute('data-guild-npc-action','talk')
        archivist_control.evaluate("(button)=>button.click()")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        archivist_card=page.locator('[data-collaborator-role="archivist"]')
        expect(archivist_card).to_be_visible()
        expect(archivist_card).to_be_focused()
        quest_talk_after=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return {revision:value.revision,eventIds:value.events.map(event=>event.id),xp:value.xp}}")
        assert quest_talk_after==quest_route_before, 'Opening the quest-selected NPC workbench must remain read-only'
        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Guild Hall")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'")
        for role in ('archivist','adversary','synthesizer','tutor'):
            expect(page.locator(f'[data-collaborator-role="{role}"]')).to_be_visible()
        archivist_workbench_packet=page.locator('[data-collaborator-role="archivist"]')
        archivist_scope=archivist_workbench_packet.locator('[data-collaborator-scope="archivist"]')
        expect(archivist_scope).to_be_visible()
        expect(archivist_scope).to_contain_text('BOUNDED ARCHIVIST SCOPE')
        expect(archivist_scope).to_contain_text('plus linked report/challenge context')
        archivist_workbench_packet.locator('details.collaborator-packet summary').click()
        archivist_handoff=archivist_workbench_packet.locator('textarea[aria-label$="hand-off packet"]').input_value()
        archivist_payload=json.loads(archivist_handoff.split('UNTRUSTED_INPUT_JSON:\n',1)[1])
        assert archivist_payload['archivistScopeVersion']==2
        assert archivist_scope.get_attribute('data-scope-version')=='2'
        assert archivist_scope.get_attribute('data-omitted-count')==str(archivist_payload['omittedCount'])
        assert archivist_scope.get_attribute('data-omitted-id-count')==str(len(archivist_payload['omittedEventIds']))
        assert archivist_scope.get_attribute('data-omitted-id-list-truncated')==str(archivist_payload['omittedEventIdListTruncated']).lower()
        assert archivist_scope.get_attribute('data-truncated-content-field-count')==str(archivist_payload['truncatedContentFieldCount'])
        expect(archivist_scope).to_contain_text(f"Eligible activity records omitted: {archivist_payload['omittedCount']}.")
        expect(archivist_scope).to_contain_text(f"Omitted IDs shown: {len(archivist_payload['omittedEventIds'])}.")
        expect(archivist_scope).to_contain_text(f"Source text fields clipped: {archivist_payload['truncatedContentFieldCount']}.")
        if archivist_payload['omittedCount']:
            expect(archivist_scope).to_contain_text('not an exhaustive chronology')
        else:
            expect(archivist_scope).to_contain_text('No eligible activity records from this chain are omitted')
        scope_state_before=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return {revision:value.revision,eventIds:value.events.map(event=>event.id),xp:value.xp}}")
        scope_details=archivist_workbench_packet.locator('details[data-collaborator-scope-details="archivist"]')
        expect(scope_details).to_be_visible()
        scope_details.locator('summary').click()
        scope_manifest=scope_details.locator('textarea[aria-label="Hostile Archivist scope details"]').input_value()
        omitted_ids=archivist_payload['omittedEventIds']
        assert archivist_payload['omittedCount']>0 and omitted_ids, 'Browser fixture must exercise a nonempty omitted-ID disclosure'
        clipped_fields=[f"{record['eventId']}: {field}" for record in archivist_payload['inputRecords'] for field in record.get('truncatedFields',[])]
        expected_scope_lines=[f"OMITTED EVENT IDS ({len(omitted_ids)} of {archivist_payload['omittedCount']})"]
        if omitted_ids:
            expected_scope_lines.extend(f"- {event_id}" for event_id in omitted_ids)
        else:
            expected_scope_lines.append('- None listed.')
        if archivist_payload['omittedEventIdListTruncated']:
            expected_scope_lines.append(f"{archivist_payload['omittedCount']-len(omitted_ids)} additional omitted event IDs are not listed in this packet.")
        expected_scope_lines.extend(['',f"CLIPPED SOURCE FIELDS ({len(clipped_fields)})"])
        expected_scope_lines.extend(clipped_fields or ['None.'])
        assert scope_manifest=='\n'.join(expected_scope_lines), 'in-world scope details must expose the exact bounded omitted IDs and clipped field names'
        assert scope_details.get_attribute('data-omitted-count')==str(archivist_payload['omittedCount'])
        assert scope_details.get_attribute('data-omitted-id-count')==str(len(omitted_ids))
        assert scope_details.get_attribute('data-omitted-id-list-truncated')==str(archivist_payload['omittedEventIdListTruncated']).lower()
        assert scope_details.get_attribute('data-clipped-field-count')==str(len(clipped_fields))
        scope_state_after=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return {revision:value.revision,eventIds:value.events.map(event=>event.id),xp:value.xp}}")
        assert scope_state_after==scope_state_before, 'expanding Archivist scope details must not mutate world history, revision, or XP'
        page.screenshot(path=str(out/'guild-archivist-scope.png'))
        if clipped_fields:
            clipped_event_id,clipped_field=clipped_fields[0].split(': ',1)
            clipped_record_link=scope_details.locator(f'button[data-archivist-clipped-event="{clipped_event_id}"][data-archivist-clipped-field="{clipped_field}"]')
            expect(clipped_record_link).to_be_visible()
        first_omitted_id=omitted_ids[0]
        retained_target=page.evaluate("""(eventId)=>{
            const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));
            const matches=value.events.filter(event=>event.id===eventId);
            if(matches.length!==1)return null;
            const event=matches[0];
            if(event.type==='experiment-reported')return {moonshotId:event.moonshotId,activityId:event.reportId,recordType:event.type};
            if(event.type==='experiment-challenged')return {moonshotId:event.moonshotId,activityId:event.challengeId,recordType:event.type};
            return null;
        }""",first_omitted_id)
        assert retained_target and retained_target['moonshotId']==archivist_payload['targetMoonshotId']
        assert retained_target['activityId'] and retained_target['recordType'] in ('experiment-reported','experiment-challenged')
        omitted_record_link=scope_details.locator(f'button[data-archivist-omitted-event="{first_omitted_id}"]')
        expect(omitted_record_link).to_be_visible()
        omitted_record_link.click()
        page.wait_for_function("""(activityId)=>{
            const sheet=document.querySelector('#sheet');
            return sheet&&!sheet.hidden&&sheet.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&
              Array.from(sheet.querySelectorAll('[data-research-activity-id]')).some(element=>element.dataset.researchActivityId===activityId);
        }""",arg=retained_target['activityId'])
        retained_record=page.locator(f'[data-research-activity-id="{retained_target["activityId"]}"]')
        expect(retained_record).to_be_visible()
        assert retained_record.evaluate('(element)=>element===document.activeElement'), 'Archivist scope navigation must focus the exact retained event card'
        scope_state_after_navigation=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return {revision:value.revision,eventIds:value.events.map(event=>event.id),xp:value.xp}}")
        assert scope_state_after_navigation==scope_state_before, 'opening a disclosed retained record must not mutate world history, revision, or XP'
        page.screenshot(path=str(out/'guild-archivist-omitted-record.png'))
        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Evidence Archive")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        packet=page.locator('[data-collaborator-role="adversary"]')
        packet.locator('details.collaborator-packet summary').click()
        prompt=packet.locator('textarea[aria-label$="hand-off packet"]').input_value()
        packet_payload=json.loads(prompt.split('UNTRUSTED_INPUT_JSON:\n',1)[1])
        target_event=next(record['eventId'] for record in packet_payload['inputRecords'] if record['type']=='experiment-reported')
        response={
            'targetEventId':target_event,
            'challengeType':'methodology',
            'challengeDraft':'The procedure does not specify a control condition.',
            'distinctnessAssessment':'This is a draft for human review against the supplied challenge.',
            'duplicateOfEventIds':[],
            'counterexample':'A controlled comparison could produce a different result.',
            'evidenceNeeded':['A retained controlled replication.'],
            'unknowns':['No independent measurement is supplied.']
        }
        valid_response_text=json.dumps(response)
        response_details=packet.locator('details.collaborator-response')
        response_details.locator('summary').click()
        response_field=response_details.locator('textarea[aria-label="Adversary response JSON"]')
        expect(response_field).to_be_visible()
        response_field.fill(valid_response_text)
        packet.get_by_role('button',name='Validate response for review',exact=True).click()
        expect(packet.locator('[data-collaborator-response-status="adversary"]')).to_contain_text('STRUCTURE VALID')
        response['targetEventId']='event-not-in-packet'
        response_field.fill(json.dumps(response))
        packet.get_by_role('button',name='Validate response for review',exact=True).click()
        expect(packet.locator('[data-collaborator-response-status="adversary"]')).to_contain_text('RESPONSE_SCHEMA_OR_SCOPE_INVALID')
        response_field.fill(valid_response_text)
        packet.get_by_role('button',name='Validate response for review',exact=True).click()
        world_before_archive=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        packet.get_by_role('button',name='Archive exact response as untrusted history →',exact=True).click()
        expect(packet.locator('[data-collaborator-response-status="adversary"]')).to_contain_text('ARCHIVED · STRUCTURE VALID FOR HUMAN REVIEW ONLY')
        world_after_archive=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        assert world_after_archive['revision']==world_before_archive['revision']+1
        assert world_after_archive['events'][:-1]==world_before_archive['events']
        archived_response=world_after_archive['events'][-1]
        assert archived_response['type']=='collaborator-response-recorded'
        assert archived_response['validationStatus']=='valid-for-human-review'
        assert archived_response['responseText']==valid_response_text
        assert world_after_archive['xp']==world_before_archive['xp']==0
        expect(page.locator('[data-objective-id="founder-guild-response"]')).to_contain_text('RECORDED')
        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Evidence Archive")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(page.locator('#sheet')).to_contain_text('BOUNDED COLLABORATOR RESPONSES')
        expect(page.locator('#sheet')).to_contain_text('STRUCTURE VALID · HUMAN REVIEW ONLY')
        page.locator('details.collaborator-response summary').filter(has_text='Inspect exact pasted response').click()
        archived_field=page.locator('textarea[aria-label="Archived collaborator response"]')
        expect(archived_field).to_have_count(1)
        assert archived_field.input_value()==valid_response_text
        close_sheet(page)
        experiment_objective=page.locator('[data-objective-id="founder-experiment-report"]')
        experiment_objective.locator('details.quest-evidence summary').click()
        attempt_event_id=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return value.events.find(event=>event.type==='experiment-reported'&&event.observation==='The attempt contradicted the prediction.')?.id}")
        assert attempt_event_id, 'the original contradictory report must remain identifiable in retained history'
        attempt_entry=experiment_objective.locator('details.quest-evidence > ul > li').filter(has_text=attempt_event_id)
        expect(attempt_entry).to_have_count(1)
        attempt_link=attempt_entry.get_by_role('button',name='Inspect attempt →',exact=True)
        expect(attempt_link).to_be_visible()
        attempt_link.click()
        page.wait_for_function("()=>{const sheet=document.querySelector('#sheet');return sheet&&!sheet.hidden&&sheet.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&sheet.querySelector('[data-research-activity-id]')?.textContent.includes('The attempt contradicted the prediction.')}")
        attempt_record=page.locator('[data-research-activity-id]').filter(has_text='The attempt contradicted the prediction.')
        assert attempt_record.evaluate('(element)=>element===document.activeElement'), 'Quest evidence should navigate to and focus the exact retained attempt'
        close_sheet(page)
        page.locator('#places-button').click()
        page.get_by_role('button',name='Inspect research record: Attempt · contradicts',exact=True).click()
        page.wait_for_function("()=>{const sheet=document.querySelector('#sheet');return sheet&&!sheet.hidden&&sheet.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&sheet.querySelector('[data-research-activity-id]')?.textContent.includes('The attempt contradicted the prediction.')}")
        activity_record=page.locator('[data-research-activity-id]').filter(has_text='The attempt contradicted the prediction.')
        assert activity_record.evaluate('(element)=>element===document.activeElement'), 'Walking to an attempt object should focus its retained report card'
        close_sheet(page)
        evidence_objective=page.locator('[data-objective-id="founder-experiment-evidence"]')
        expect(evidence_objective).to_contain_text('OPEN')
        latest_unlinked_observation=page.evaluate("()=>{const value=JSON.parse(localStorage.getItem('ngl.common-ground.v2'));return [...value.events].reverse().find(event=>event.type==='experiment-reported'&&event.evidenceCreationId===null)?.observation}")
        assert latest_unlinked_observation, 'the newest unlinked report must remain identifiable in retained history'
        evidence_objective.get_by_role('button',name='Go do this →',exact=True).click()
        page.wait_for_function("(observation)=>{const sheet=document.querySelector('#sheet');return sheet&&!sheet.hidden&&sheet.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&Array.from(sheet.querySelectorAll('[data-research-activity-id]')).some(element=>element.textContent.includes(observation))}",arg=latest_unlinked_observation)
        activity_record=page.locator('[data-research-activity-id]').filter(has_text=latest_unlinked_observation)
        assert activity_record.evaluate('(element)=>element===document.activeElement'), 'The evidence quest should focus the exact unlinked report'
        expect(activity_record.get_by_role('button',name='Build a source observatory →',exact=True)).to_be_visible()
        activity_record.get_by_role('button',name='Build a source observatory →',exact=True).click()
        expect(page.locator('#sheet-title')).to_have_text('Give an idea a place.')
        expect(page.locator('#recipe-select')).to_have_value('observatory')
        page.locator('#command-input').fill('Retained evidence observatory')
        page.locator('#intent-input').fill('Preserve a source and its uncertainty beside the exact bytes.')
        page.locator('#draft-button').click()
        page.locator('#publish-button').wait_for()
        page.locator('#preview-button').click()
        frame=page.frame_locator('#artifact-frame')
        expect(frame.locator('html')).to_have_attribute('data-ngl-ready', 'true')
        expect(page.locator('#artifact-frame')).to_have_attribute('aria-busy', 'false')
        expect(page.locator('#artifact-frame')).to_have_attribute('data-ngl-input-ready', 'true')
        page.locator('#portal-close').click()
        page.locator('#publish-button').click()
        page.wait_for_function("()=>document.querySelector('#creation-count').textContent==='1' && document.querySelector('#xp-count').textContent==='100'")
        close_sheet(page)
        evidence_objective=page.locator('[data-objective-id="founder-experiment-evidence"]')
        expect(evidence_objective).to_contain_text('OPEN')
        evidence_objective.get_by_role('button',name='Go do this →',exact=True).click()
        page.wait_for_function("(observation)=>{const sheet=document.querySelector('#sheet');return sheet&&!sheet.hidden&&sheet.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&Array.from(sheet.querySelectorAll('[data-research-activity-id]')).some(element=>element.textContent.includes(observation))}",arg=latest_unlinked_observation)
        activity_record=page.locator('[data-research-activity-id]').filter(has_text=latest_unlinked_observation)
        follow_up=activity_record.get_by_role('button',name='Record a linked follow-up attempt →',exact=True)
        expect(follow_up).to_be_visible()
        follow_up.click()
        expect(page.locator('#sheet-title')).to_have_text('Record an attempt.')
        evidence_source=page.locator('#experiment-evidence-source')
        evidence_value=evidence_source.locator('option').nth(1).get_attribute('value')
        assert evidence_value, 'A retained artifact should be selectable for the follow-up attempt'
        evidence_source.select_option(value=evidence_value)
        page.locator('#experiment-evidence-version').select_option('1')
        page.locator('#experiment-procedure').fill('Repeat the bounded procedure against the retained source.')
        page.locator('#experiment-observation').fill('The follow-up remains inconclusive; this is not a truth verdict.')
        page.locator('#experiment-outcome').select_option('inconclusive')
        page.locator('#report-experiment').click()
        expect(page.locator('[data-objective-id="founder-experiment-evidence"]')).to_contain_text('RECORDED')
        expect(page.locator('#xp-count')).to_have_text('100')
        linked_report=page.locator('[data-research-activity-id]').filter(has_text='The follow-up remains inconclusive; this is not a truth verdict.')
        expect(linked_report.get_by_role('button',name='Inspect retained evidence v1 →',exact=True)).to_be_visible()
        page.screenshot(path=str(out/'institutional-locations.png'))
        assert not errors,errors
        return {'journey':'institutional-location-actions','passed':True,'locations':len(cases)+1,'moonshotProposals':1,'moonshotWorldObjects':1,'experimentReports':5,'researchActivityObjects':5,'creations':1,'xp':100,'errors':errors}
    finally:
        context.close()


def shared(browser,url,data,out):
    errors=[];presence_errors=[]
    owner=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    visitor=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    state_read_retries={'count':0}
    def read_state(context):
        try:
            return context.request.get(url+'api/state',timeout=10000).json()
        except Exception as error:
            message=str(error).lower()
            # GET /api/state is read-only. Retry one connection reset only;
            # mutations are never automatically retried by this test helper.
            if 'socket hang up' not in message and 'econnreset' not in message:
                raise
            state_read_retries['count']+=1
            return context.request.get(url+'api/state',timeout=10000).json()

    def assert_navigation_only_discovers(before_state,after_state,label):
        before_world=before_state['world'];after_world=after_state['world']
        before_events=before_world['events'];after_events=after_world['events']
        before_ids={event['id'] for event in before_events}
        after_ids={event['id'] for event in after_events}
        assert before_ids.issubset(after_ids), label+': retained history must not disappear'
        new_events=[event for event in after_events if event['id'] not in before_ids]
        revision_delta=after_world['revision']-before_world['revision']
        assert revision_delta==len(new_events), label+': revision delta must be explained by retained events; new events='+str(new_events)
        assert all(event.get('type')=='discover' for event in new_events), label+': navigation may append only landmark-discovery events; new events='+str(new_events)
        assert after_world['xp']==before_world['xp'], label+': navigation must not award XP'
        return new_events

    def read_page_state(page):
        return page.evaluate("""async () => {
            const response=await fetch('/api/state',{cache:'no-store',credentials:'same-origin'});
            if(!response.ok)throw new Error('Authenticated browser state read failed: '+response.status);
            return await response.json();
        }""")

    def wait_for_page_event(page,event_type,fields):
        page.wait_for_function("""async ({eventType,fields}) => {
            const response=await fetch('/api/state',{cache:'no-store',credentials:'same-origin'});
            if(!response.ok)return false;
            const state=await response.json();
            return state.world.events.some(event=>event.type===eventType&&Object.entries(fields).every(([key,value])=>{
                if(key==='actorId')return event.actor?.id===value;
                if(key==='actorRole')return event.actor?.role===value;
                return event[key]===value;
            }));
        }""",arg={'eventType':event_type,'fields':fields})

    def read_page_state_until_event(page,event_type,fields):
        last_state=None
        for _ in range(50):
            last_state=read_page_state(page)
            events=(last_state.get('world') or {}).get('events') or []
            if any(event.get('type')==event_type and all(
                (event.get('actor') or {}).get('id')==value if key=='actorId' else
                (event.get('actor') or {}).get('role')==value if key=='actorRole' else
                event.get(key)==value
                for key,value in fields.items()
            ) for event in events):
                return last_state
            page.wait_for_timeout(100)
        world=(last_state or {}).get('world') or {}
        raise AssertionError({
            'expectedEvent':event_type,
            'fields':fields,
            'revision':world.get('revision'),
            'eventCount':len(world.get('events') or []),
            'page':'authenticated browser state did not expose the committed event within 5 seconds'
        })
    try:
        a,b=owner.new_page(),visitor.new_page()
        for page in [a,b]:
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('response',lambda response:presence_errors.append(response.status) if '/api/presence' in response.url and response.status>=400 else None)
            page.goto(url);page.locator('#start-shared').click()
            page.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "The Relay")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#sheet .primary-button')).to_have_text('Explore another guide →')
        close_sheet(b)

        # Before any Observatory publication exists, a Witness can inspect the
        # empty research room but cannot create or publish its first target.
        b.locator('#places-button').click()
        walk_to_location(b, "Source Observatory")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Source Observatory'")
        expect(b.locator('[data-source-observatory]')).to_be_visible()
        expect(b.locator('#sheet')).to_contain_text('No uniquely retained, published Source Observatory version is available yet.')
        expect(b.locator('#sheet')).to_contain_text('Wait for the Founder to publish a Source Observatory')
        expect(b.locator('[data-source-observatory-create]')).to_have_count(0)
        witness_empty_before=read_state(visitor)['world']
        assert witness_empty_before['creations']==[] and witness_empty_before['xp']==0
        close_sheet(b)
        witness_empty_after=read_state(visitor)['world']
        assert witness_empty_after['revision']==witness_empty_before['revision']
        assert witness_empty_after['xp']==witness_empty_before['xp']

        a.locator('#login-button').click();a.locator('#founder-key').fill(KEY);a.locator('#verify-founder').click()
        a.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Founder')")

        # The same empty room gives the Founder one explicit path into the
        # Observatory recipe. Opening it is still read-only until a draft action.
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Source Observatory")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Source Observatory'")
        create_observatory=a.locator('[data-source-observatory-create]')
        expect(create_observatory).to_be_visible()
        founder_empty_before=read_state(owner)['world']
        create_observatory.click()
        expect(a.locator('#sheet-title')).to_have_text('Give an idea a place.')
        expect(a.locator('#recipe-select')).to_have_value('observatory')
        founder_empty_after=read_state(owner)['world']
        assert founder_empty_after['creations']==[] and founder_empty_after['xp']==0
        assert founder_empty_after['revision']==founder_empty_before['revision']
        close_sheet(a)

        # A real pending decision proposal must remain reviewable but not actionable
        # until the live server verifies a signed Founder disposition.
        decision_bytes='Browser fixture only: a pending proposal for the read-only Decision Chamber acceptance path.'
        decision_policy=owner.request.post(url+'api/decisions/policy',data={
            'id':'browser-decision-policy',
            'reviewWindowMs':86400000,
            'basis':'Disposable browser acceptance fixture; no operational policy activation.'
        })
        assert decision_policy.status==200, decision_policy.text()
        decision_proposal=owner.request.post(url+'api/decisions/proposals',data={
            'id':'decision:browser-authorization-gate',
            'title':'Browser authorization gate fixture',
            'evaluation':{
                'bytes':decision_bytes,
                'receipt':{
                    'algorithm':'sha256',
                    'digest':hashlib.sha256(decision_bytes.encode('utf-8')).hexdigest(),
                    'size':len(decision_bytes.encode('utf-8'))
                }
            },
            'risks':['Disposable browser fixture only; no external effect.'],
            'rollback':'No source or external state changed.',
            'proposedEffect':'Exercise the read-only Decision Chamber; no disposition is permitted.'
        })
        assert decision_proposal.status==200, decision_proposal.text()
        decision_before=owner.request.get(url+'api/decisions').json()
        assert decision_before['dispositionAuthorization']['available'] is False
        assert decision_before['dispositionAuthorization']['code']=='FOUNDER_NOT_ENROLLED'
        assert decision_before['decisions'][0]['status']=='PENDING'
        world_before_decision=read_state(owner)['world']
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Founder Gate")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Decision Chamber'&&!document.querySelector('#sheet').hidden")
        expect(a.locator('#sheet-kicker')).to_have_text('HUMAN GATE · DECISIONS')
        expect(a.locator('#sheet')).to_contain_text('Browser authorization gate fixture')
        expect(a.locator('#sheet')).to_contain_text('Founder trust anchor is not enrolled')
        expect(a.locator('#sheet [data-decision-authorization-blocked="true"]')).to_have_count(1)
        expect(a.locator('#sheet [data-gate-action]')).to_have_count(0)
        a.screenshot(path=str(out/'decision-chamber-authorization-blocked.png'))
        close_sheet(a)

        # The Witness session receives the public readiness code, but no Founder
        # evaluation bytes or disposition controls. Inspection remains read-only.
        close_sheet(b)
        b.locator('#places-button').click()
        walk_to_location(b, "Founder Gate")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Decision Chamber'&&!document.querySelector('#sheet').hidden")
        expect(b.locator('#sheet [data-gate-readiness-code="FOUNDER_NOT_ENROLLED"]')).to_have_count(1)
        expect(b.locator('#sheet [data-witness-disposition-controls-withheld="true"]')).to_have_count(1)
        expect(b.locator('#sheet [data-gate-action]')).to_have_count(0)
        expect(b.locator('#sheet')).to_contain_text('not a decision, evidence, approval, or authority grant')
        expect(b.locator('#sheet')).not_to_contain_text(decision_bytes)
        b.screenshot(path=str(out/'decision-chamber-witness-readiness.png'))
        witness_decisions=visitor.request.get(url+'api/decisions').json()
        assert witness_decisions['dispositionAuthorization']['code']=='FOUNDER_NOT_ENROLLED'
        assert decision_bytes not in json.dumps(witness_decisions), 'Witness decision snapshots must not expose Founder evaluation bytes'
        close_sheet(b)

        decision_after=owner.request.get(url+'api/decisions').json()
        world_after_decision=read_state(owner)['world']
        assert decision_after['revision']==decision_before['revision']
        assert decision_after['decisions'][0]['status']=='PENDING'
        assert world_after_decision['revision']==world_before_decision['revision']
        assert world_after_decision['xp']==world_before_decision['xp']

        draft(a,'custom','PRIVATE_DRAFT_MARKER')
        close_sheet(a)
        snapshot=read_state(visitor)
        assert snapshot['world']['drafts']==[] and 'PRIVATE_DRAFT_MARKER' not in json.dumps(snapshot)
        assert 'PRIVATE_DRAFT_MARKER' not in visitor.request.get(url+'api/export').text()
        assert visitor.request.post(url+'api/action',data={'type':'draft','kind':'loom','title':'Forbidden','intent':'Denied'}).status==403
        draft(a,'observatory','The shared observatory')
        a.locator('#publish-button').click()
        b.wait_for_function("()=>document.querySelector('#creation-count').textContent==='1'")
        assert b.locator('#xp-count').text_content()=='100', 'The shared world retains institution-wide XP'
        expect(b.locator('#character-button')).to_be_visible()
        b.locator('#character-button').click()
        expect(b.locator('#sheet')).to_contain_text('0 character XP')
        expect(b.locator('#sheet')).to_contain_text('100 institution-wide XP across the world.')
        close_sheet(b)
        snapshot=read_state(visitor);creation=snapshot['world']['creations'][0];creation_id=creation['id']
        original=visitor.request.get(url+f'api/artifacts/{creation_id}?version=1').text()
        assert len(snapshot['institution']['kernel']['accepted'])==1
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "River of Receipts")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='The river remembers bytes.')
        expect(b.locator('#sheet .primary-button')).to_have_text('Inspect a published receipt →')
        b.locator('#sheet .primary-button').click();b.locator('#enter-creation').wait_for();close_sheet(b)
        visit(b,'The shared observatory');b.locator('#enter-creation').click()
        frame=b.frame_locator('#artifact-frame')
        # The artifact advertises readiness only after its inline recipe script has
        # attached handlers and rendered the initial receipt.
        expect(frame.locator('html')).to_have_attribute('data-ngl-ready', 'true')
        # Script readiness and the parent portal's painted/input surface are separate gates.
        expect(b.locator('#artifact-frame')).to_have_attribute('aria-busy', 'false')
        expect(frame.locator('#observations article')).to_have_count(0)
        expect(frame.locator('body')).to_contain_text('Notes remain local to this open artifact')
        frame.locator('#claim').fill('<b>Source note</b> — café 🌍')
        frame.locator('#source-kind').select_option('model-assertion')
        frame.locator('#source').fill('Cliffy · https://example.org/source')
        frame.locator('#falsifier').fill('A reproducible counterexample.')
        frame.locator('#uncertainty').fill('A note is not a verdict.')
        frame.locator('#next-test').fill('Retrieve and inspect the primary source.')
        frame.locator('#add-observation').click()
        expect(frame.locator('#status')).to_have_text('Observation added to this open artifact. No source was fetched or independently verified.')
        expect(frame.locator('#observations article')).to_have_count(1)
        assert frame.locator('#observations b').count()==0
        expect(frame.locator('#observations')).to_contain_text('Possible falsifier: A reproducible counterexample.')
        expect(frame.locator('#observations')).to_contain_text('Model assertion: lead only, not evidence.')
        with b.expect_download() as downloaded:frame.locator('#download').click()
        notes=json.loads(Path(downloaded.value.path()).read_text())
        assert notes['schema']=='ngl.source-observatory.v2'
        assert notes['assurance']=={
            'sourceRetrieval':'NOT_PERFORMED',
            'independentVerification':'NOT_PERFORMED',
            'modelAssertions':'LEADS_ONLY',
            'execution':'NOT_EXECUTED'
        }
        observation=notes['observations'][0]
        assert observation['claim']=='<b>Source note</b> — café 🌍'
        assert observation['sourceKind']=='model-assertion'
        assert observation['falsifier']=='A reproducible counterexample.'
        assert observation['uncertainty']=='A note is not a verdict.'
        assert observation['nextTest']=='Retrieve and inspect the primary source.'
        b.locator('#portal-close').click()
        # Record directly inside the Source Observatory; the export importer remains
        # available for older notebook files, but ordinary play needs no file round-trip.
        close_sheet(b)
        source_viewport=b.viewport_size
        b.set_viewport_size({'width':320,'height':740})
        observation_objective=b.locator('[data-objective-id="witness-source-observation"]')
        expect(observation_objective).to_contain_text('OPEN')
        observation_objective.get_by_role('button',name='Go do this →',exact=True).click()
        # The quest routes to the Observatory; entering its workbench is a separate action.
        wait_for_nearby_institution(b, 'source_observatory')
        expect(b.locator('#sheet')).to_be_hidden()
        enter_nearby_institution(b, 'source_observatory')
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Source Observatory'")
        expect(b.locator('[data-source-observatory]')).to_be_visible()
        expect(b.locator('[data-source-observatory]')).to_have_attribute('aria-label','Source Observatory research workbench')
        assert not b.locator('#sheet').evaluate('(element)=>element.scrollWidth>element.clientWidth'), 'The Source Observatory workbench must not overflow horizontally at 320px'
        target_card=b.locator('[data-source-observatory-target]').filter(has_text='The shared observatory')
        expect(target_card).to_have_count(1)
        expect(target_card).to_contain_text('0 uniquely linked note(s)')
        before_observation=read_state(visitor)
        before_observation_revision=before_observation['world']['revision']
        witness_id=before_observation['viewer']['id']
        assert before_observation['world']['xp']==100
        record_button=target_card.locator('[data-source-observatory-record]')
        expect(record_button).to_be_visible()
        b.set_viewport_size(source_viewport)
        record_button.click()
        expect(b.locator('[data-source-observation-form]')).to_be_visible()
        after_workbench_open=read_state(visitor)
        assert after_workbench_open['world']['revision']==before_observation_revision, 'Opening and selecting a workbench target must be read-only'
        assert after_workbench_open['world']['xp']==before_observation['world']['xp'], 'Opening the workbench must not award XP'
        offline_claim='The shared model says the bridge is open; no source has been retrieved.'
        # A request that never reaches the server must remain a local Relay receipt,
        # and must not appear in canonical state until the player reconnects.
        offline_attempt={'remaining':True}
        def disconnect_source_observation(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if offline_attempt['remaining'] and payload.get('type')=='record-source-observation':
                offline_attempt['remaining']=False
                route.abort('internetdisconnected')
                return
            route.continue_()
        b.route('**/api/action',disconnect_source_observation)
        expect(b.locator('[data-source-observation-form]')).to_be_visible()
        b.locator('#source-observation-claim').fill(offline_claim)
        b.locator('#source-observation-kind').select_option('model-assertion')
        b.locator('#source-observation-source').fill('A pasted model response; no source was retrieved.')
        b.locator('#source-observation-falsifier').fill('A direct inspection finds the bridge closed.')
        b.locator('#source-observation-uncertainty').fill('No independent observation has been made.')
        b.locator('#source-observation-next-test').fill('Inspect the bridge and retain the observation.')
        b.locator('#source-observation-submit').click()
        expect(b.locator('#toast')).to_contain_text('unreachable')
        pending_raw=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert pending_raw, 'A pre-commit network failure must preserve the exact local Relay receipt'
        pending_offline=json.loads(pending_raw)
        assert pending_offline['actorId']==witness_id
        assert pending_offline['action']['type']=='record-source-observation'
        assert pending_offline['action']['claim']==offline_claim
        assert pending_offline['requestId']==pending_offline['action']['observationId']
        not_committed=read_state(visitor)
        assert not any(event['type']=='source-observation-recorded' for event in not_committed['world']['events']), 'A request aborted before server receipt must not create a canonical event'
        assert not_committed['world']['revision']==before_observation_revision
        assert not_committed['world']['xp']==before_observation['world']['xp']==100
        b.unroute('**/api/action',disconnect_source_observation)
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "The Relay")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · RECORD-SOURCE-OBSERVATION')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        assert not b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'A successful exact retry must clear the pending receipt'
        first_recovery=read_state(visitor)
        first_observations=[event for event in first_recovery['world']['events'] if event['type']=='source-observation-recorded']
        assert len(first_observations)==1 and first_observations[0]['claim']==offline_claim
        assert first_observations[0]['actor']['id']==witness_id and first_observations[0]['actor']['role']=='witness'
        assert first_recovery['world']['revision']==before_observation_revision+1
        assert first_recovery['world']['xp']==before_observation['world']['xp']==100
        close_sheet(b)
        b.locator('#places-button').click()
        walk_to_location(b, "Source Observatory")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Source Observatory'")
        refreshed_target=b.locator('[data-source-observatory-target]').filter(has_text='The shared observatory')
        expect(refreshed_target).to_contain_text('1 uniquely linked note(s)')
        visit(b,'The shared observatory')
        source_claim='<'+'script>not code</'+'script> The shared model says the bridge is open.'
        lost_observation={'remaining':True}
        def lose_source_observation_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if lost_observation['remaining'] and payload.get('type')=='record-source-observation':
                committed=route.fetch()
                assert committed.status==200, 'The service must commit the observation before the simulated response loss'
                lost_observation['remaining']=False
                route.fulfill(status=503,content_type='application/json',body=json.dumps({
                    'error':{'code':'SIMULATED_RESPONSE_LOSS','message':'Response lost after commit.'}
                }))
                return
            route.continue_()
        b.route('**/api/action',lose_source_observation_response)
        b.locator('#source-observation-open').click()
        expect(b.locator('[data-source-observation-form]')).to_be_visible()
        b.locator('#source-observation-claim').fill(source_claim)
        b.locator('#source-observation-kind').select_option('model-assertion')
        b.locator('#source-observation-source').fill('A pasted model response; no source was retrieved.')
        b.locator('#source-observation-falsifier').fill('A direct inspection finds the bridge closed.')
        b.locator('#source-observation-uncertainty').fill('No independent observation has been made.')
        b.locator('#source-observation-next-test').fill('Inspect the bridge and retain the observation.')
        b.locator('#source-observation-submit').click()
        expect(b.locator('#toast')).to_contain_text('Response lost after commit')
        pending_raw=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert pending_raw, 'A committed observation with a lost response must leave a local Relay receipt'
        pending_observation=json.loads(pending_raw)
        assert pending_observation['actorId']==witness_id
        assert pending_observation['action']['type']=='record-source-observation'
        assert pending_observation['requestId']==pending_observation['action']['observationId']
        assert pending_observation['requestId'].startswith('source-observation-')
        committed_before_retry=read_state(visitor)
        committed_events=[event for event in committed_before_retry['world']['events'] if event['type']=='source-observation-recorded']
        assert len(committed_events)==2 and committed_events[-1]['claim']==source_claim, 'The independent state read must observe the second committed note before Relay retry'
        assert committed_before_retry['world']['revision']==before_observation_revision+2
        assert committed_before_retry['world']['xp']==before_observation['world']['xp']==100
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "The Relay")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · RECORD-SOURCE-OBSERVATION')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        assert not b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'A successful exact retry must clear the pending receipt'
        recovered_observation=read_state(visitor)
        source_observations=[event for event in recovered_observation['world']['events'] if event['type']=='source-observation-recorded']
        assert len(source_observations)==2
        source_observation=next(event for event in source_observations if event['claim']==source_claim)
        assert source_observation['actor']['id']==witness_id
        assert source_observation['actor']['role']=='witness'
        assert source_observation['version']==1
        assert source_observation['originSchema']=='ngl.source-observatory.v2'
        assert source_observation['bindingMode']=='USER_SELECTED'
        assert source_observation['sourceKind']=='model-assertion'
        assert source_observation['observationId'].startswith('source-observation-')
        assert source_observation['requestId']==source_observation['observationId']
        assert source_observation['actionResult']=={'duplicate':False,'observationId':source_observation['observationId']}
        assert source_observation['normalizedRecordDigest']==source_observation['observationId'].removeprefix('source-observation-')
        assert source_observation['sourceRetrieval']=='NOT_PERFORMED'
        assert source_observation['independentVerification']=='NOT_PERFORMED'
        assert source_observation['modelAssertions']=='LEADS_ONLY'
        assert source_observation['execution']=='NOT_EXECUTED'
        assert recovered_observation['world']['revision']==before_observation_revision+2
        assert recovered_observation['world']['xp']==before_observation['world']['xp']==100, 'Recording and retrying an observation must not award XP'
        expect(b.locator('[data-objective-id="witness-source-observation"]')).to_contain_text('RECORDED')
        b.unroute('**/api/action',lose_source_observation_response)
        visit(b,'The shared observatory')
        expect(b.locator('#source-observations')).to_contain_text(offline_claim)
        expect(b.locator('#source-observations')).to_contain_text(source_claim)
        expect(b.locator('[data-source-observation-card]')).to_have_count(2)
        assert b.locator('#source-observations script').count()==0, 'Claim text must remain text, not executable markup'
        expect(b.locator('#source-observations')).to_contain_text('Model assertions are leads only, not evidence.')
        close_sheet(b)
        b.locator('#character-button').click()
        expect(b.locator('#sheet')).to_contain_text('Source Recorder')
        expect(b.locator('#sheet')).to_contain_text('2 recorded')
        close_sheet(b)
        b.locator('#places-button').click()
        walk_to_location(b, "Evidence Archive")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(b.locator('[data-source-observation-card]')).to_have_count(2)
        expect(b.locator('#sheet')).to_contain_text('Model assertions are leads only, not evidence.')
        close_sheet(b)
        visit(b,'The shared observatory')
        visit(a,'The shared observatory')
        expect(a.locator('#source-observations')).to_contain_text(offline_claim)
        expect(a.locator('#source-observations')).to_contain_text(source_claim)
        before_challenge=read_state(visitor)
        challenge_text='The note cites a model response but no retrievable primary source.'
        lost_challenge={'remaining':True}
        def lose_source_challenge_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if lost_challenge['remaining'] and payload.get('type')=='challenge-source-observation':
                lost_challenge['payload']=payload
                committed=route.fetch()
                lost_challenge['response']=committed.json()
                assert committed.status==200, 'The service must commit the challenge before the simulated response loss'
                lost_challenge['remaining']=False
                route.fulfill(status=503,content_type='application/json',body=json.dumps({
                    'error':{'code':'SIMULATED_RESPONSE_LOSS','message':'Challenge response lost after commit.'}
                }))
                return
            route.continue_()
        a.route('**/api/action',lose_source_challenge_response)
        challenge_card=a.locator(f'[data-source-observation-card][data-observation-id="{source_observation["observationId"]}"]')
        challenge_details=challenge_card.locator('[data-source-observation-challenge-form]')
        expect(challenge_details).to_have_count(1)
        challenge_details.locator('summary').click()
        challenge_details.locator('select').select_option('missing-evidence')
        challenge_details.locator('textarea').fill(challenge_text)
        challenge_details.get_by_role('button',name='Preserve dissent',exact=True).click()
        # The local receipt is written before the network outcome is known. Wait
        # for the simulated 503 toast so the server-side route.fetch has finished
        # committing before the independent state read below.
        expect(a.locator('#toast')).to_contain_text('Challenge response lost after commit')
        assert lost_challenge['remaining'] is False, 'The simulated response loss must finish after the server commit'
        pending_challenge_raw=a.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert pending_challenge_raw, 'A lost response must preserve the exact challenge receipt in the Relay queue'
        pending_challenge=json.loads(pending_challenge_raw)
        assert pending_challenge['actorId']=='damien'
        assert pending_challenge['action']['type']=='challenge-source-observation'
        assert pending_challenge['action']['observationId']==source_observation['observationId']
        committed_challenge=read_state(visitor)
        challenge_events=[event for event in committed_challenge['world']['events'] if event['type']=='source-observation-challenged']
        challenge_diagnostic={'expected':challenge_text,'events':challenge_events,'revision':committed_challenge['world']['revision'],'xp':committed_challenge['world']['xp'],'before_revision':before_challenge['world']['revision'],'pending':pending_challenge,'route':lost_challenge,'existing_request_ids':[event.get('requestId') for event in committed_challenge['world']['events'] if event.get('requestId')]}
        assert len(challenge_events)==1 and challenge_events[0].get('challengeText')==challenge_text, json.dumps(challenge_diagnostic,ensure_ascii=False)
        assert challenge_events[0]['actor']['id']=='damien' and challenge_events[0]['actor']['role']=='founder'
        assert committed_challenge['world']['revision']==before_challenge['world']['revision']+1
        assert committed_challenge['world']['xp']==before_challenge['world']['xp']==100
        a.unroute('**/api/action',lose_source_challenge_response)
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "The Relay")
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(a.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(a.locator('#relay-pending-action')).to_contain_text('Pending action · CHALLENGE-SOURCE-OBSERVATION')
        a.locator('#relay-retry-pending-shared-action').click()
        expect(a.locator('#sheet')).to_be_hidden()
        assert not a.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'Exact challenge retry must clear the pending receipt'
        after_challenge_retry=read_state(visitor)
        assert len([event for event in after_challenge_retry['world']['events'] if event['type']=='source-observation-challenged'])==1
        assert after_challenge_retry['world']['revision']==committed_challenge['world']['revision'], 'Exact retry must not append a second challenge'
        assert after_challenge_retry['world']['xp']==before_challenge['world']['xp']==100
        # Exercise the Evidence Archive docket as a real world interaction.
        # The challenger can inspect the exact version but cannot see the author's response control.
        before_docket=read_state(visitor)
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Evidence Archive")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(a.locator('#sheet')).to_contain_text('SOURCE OBSERVATORY · AUTHOR RESPONSE QUEUE')
        expect(a.locator('#sheet')).to_contain_text('1 uniquely linked challenge(s) await an author response')
        expect(a.locator('#sheet')).to_contain_text('SOURCE OBSERVATION REGISTER')
        expect(a.locator('#sheet')).to_contain_text(source_observation['claim'])
        expect(a.locator('#sheet')).to_contain_text(source_observation['source'])
        expect(a.locator('#sheet')).to_contain_text(source_observation['falsifier'])
        expect(a.locator('#sheet')).to_contain_text(source_observation['nextTest'])
        expect(a.locator('#sheet')).to_contain_text('Source retrieval NOT_PERFORMED')
        expect(a.locator('#sheet')).to_contain_text('Independent verification NOT_PERFORMED')
        register_selector='[data-source-observation-register-open="'+source_observation["observationId"]+'"]'
        register_button=a.locator(register_selector)
        expect(register_button).to_have_count(1)
        a.screenshot(path=str(out/'source-observation-register.png'))
        register_button.click()
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='The shared observatory')
        expect(a.locator('#version-select')).to_have_value(str(source_observation['version']))
        after_register=read_state(visitor)
        assert after_register['world']['revision']==before_docket['world']['revision'], 'Opening a read-only register entry must not append a world event'
        assert after_register['world']['xp']==before_docket['world']['xp'], 'Opening a read-only register entry must not award XP'
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Evidence Archive")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        docket_selector='[data-source-observation-pending-challenge="'+challenge_events[0]["challengeId"]+'"]'
        docket_button=a.locator(docket_selector)
        expect(docket_button).to_have_count(1)
        a.screenshot(path=str(out/'source-observation-response-docket-pending.png'))
        docket_button.click()
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='The shared observatory')
        expect(a.locator('#version-select')).to_have_value(str(source_observation['version']))
        expect(a.locator('[data-source-observation-response-details]')).to_have_count(0)
        after_docket=read_state(visitor)
        assert after_docket['world']['revision']==before_docket['world']['revision'], 'Opening the read-only docket and exact version must not append a world event'
        assert after_docket['world']['xp']==before_docket['world']['xp'], 'Opening the read-only docket and exact version must not award XP'

        # The original Witness author can answer from the same docket without editing the note.
        visit(b,'The shared observatory')
        expect(b.locator('[data-source-observation-challenge]')).to_have_count(1)
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "Evidence Archive")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(b.locator('#sheet')).to_contain_text('1 uniquely linked challenge(s) await an author response')
        author_docket_button=b.locator(docket_selector)
        expect(author_docket_button).to_have_count(1)
        author_docket_button.click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='The shared observatory')
        expect(b.locator('#version-select')).to_have_value(str(source_observation['version']))
        expect(b.locator('[data-source-observation-response-details]')).to_have_count(1)
        response_text='The note is a lead only; source retrieval remains outstanding.'
        before_author_response=read_state(visitor)
        lost_author_response={'remaining':True}
        def lose_source_author_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if lost_author_response['remaining'] and payload.get('type')=='respond-source-observation-challenge':
                lost_author_response['payload']=payload
                committed=route.fetch()
                lost_author_response['response']=committed.json()
                assert committed.status==200, 'The author response must commit before the simulated response loss'
                lost_author_response['remaining']=False
                route.fulfill(status=503,content_type='application/json',body=json.dumps({
                    'error':{'code':'SIMULATED_RESPONSE_LOSS','message':'Author response lost after commit.'}
                }))
                return
            route.continue_()
        b.route('**/api/action',lose_source_author_response)
        response_card=b.locator(f'[data-source-observation-card][data-observation-id="{source_observation["observationId"]}"]')
        response_details=response_card.locator('[data-source-observation-response-details]')
        expect(response_details).to_have_count(1)
        response_details.locator('summary').click()
        response_details.locator('textarea').fill(response_text)
        response_details.get_by_role('button',name='Preserve author response',exact=True).click()
        expect(b.locator('#toast')).to_contain_text('Author response lost after commit')
        assert lost_author_response['remaining'] is False, 'The simulated author-response loss must finish after the server commit'
        pending_author_raw=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert pending_author_raw, 'A committed author response with a lost response must leave a local Relay receipt'
        pending_author=json.loads(pending_author_raw)
        assert pending_author['actorId']==witness_id
        assert pending_author['action']['type']=='respond-source-observation-challenge'
        assert pending_author['action']['challengeId']==challenge_events[0]['challengeId']
        committed_author_response=read_state(visitor)
        author_response_events=[event for event in committed_author_response['world']['events'] if event['type']=='source-observation-challenge-responded']
        assert len(author_response_events)==1 and author_response_events[0]['responseText']==response_text
        assert author_response_events[0]['actor']['id']==witness_id and author_response_events[0]['actor']['role']=='witness'
        assert author_response_events[0]['observationId']==source_observation['observationId']
        assert author_response_events[0]['creationId']==source_observation['creationId'] and author_response_events[0]['version']==source_observation['version']
        assert committed_author_response['world']['revision']==before_author_response['world']['revision']+1
        assert committed_author_response['world']['xp']==before_author_response['world']['xp']==100
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "The Relay")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · RESPOND-SOURCE-OBSERVATION-CHALLENGE')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        assert not b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'Exact author-response retry must clear the pending receipt'
        after_author_response_retry=read_state(visitor)
        assert len([event for event in after_author_response_retry['world']['events'] if event['type']=='source-observation-challenge-responded'])==1
        assert after_author_response_retry['world']['revision']==committed_author_response['world']['revision'], 'Exact author-response retry must not append a second response'
        assert after_author_response_retry['world']['xp']==before_author_response['world']['xp']==100
        b.unroute('**/api/action',lose_source_author_response)
        visit(b,'The shared observatory')
        expect(b.locator('#source-observations')).to_contain_text(response_text)
        expect(b.locator('[data-source-observation-response]')).to_have_count(1)
        map_events=after_author_response_retry['world']['events']
        map_notes=sum(event.get('type')=='source-observation-recorded' for event in map_events)
        map_dissent=sum(event.get('type')=='source-observation-challenged' for event in map_events)
        map_responses=sum(event.get('type')=='source-observation-challenge-responded' for event in map_events)
        expect(b.locator('#world')).to_have_attribute(
            'data-source-observation-counts',
            f'notes={map_notes};dissent={map_dissent};responses={map_responses};pending=0;review=0'
        )
        def count_phrase(count,singular,plural):
            return f'{count} {singular if count==1 else plural}'
        expected_map_accessibility=(
            'Evidence Archive: '+
            count_phrase(map_notes,'linked Source Observation note','linked Source Observation notes')+', '+
            count_phrase(map_dissent,'linked dissent challenge','linked dissent challenges')+', '+
            count_phrase(map_responses,'linked author response','linked author responses')+', '+
            '0 pending author responses, and 0 retained records requiring review'
        )
        expect(b.locator('#world')).to_have_attribute(
            'aria-label',
            re.compile(re.escape(expected_map_accessibility))
        )
        close_sheet(b);b.locator('#character-button').click()
        expect(b.locator('#sheet')).to_contain_text('Source Responder')
        expect(b.locator('#sheet')).to_contain_text('1 recorded')
        close_sheet(b)
        expect(b.locator('[data-objective-id="witness-source-observation-response"]')).to_contain_text('RECORDED')
        visit(a,'The shared observatory')
        visit(b,'The shared observatory')
        expect(a.locator('#source-observations')).to_contain_text(challenge_text)
        expect(a.locator('#source-observations')).to_contain_text(response_text)
        expect(a.locator('[data-source-observation-challenge]')).to_have_count(1)
        expect(a.locator('[data-source-observation-response]')).to_have_count(1)
        expect(b.locator('#source-observations')).to_contain_text(challenge_text)

        # The answered challenge leaves the action queue but remains in shared Chronicle history.
        docket_before_answered_view=read_state(visitor)
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Evidence Archive")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(a.locator('[data-source-observation-pending-challenge]')).to_have_count(0)
        expect(a.locator('#sheet')).to_contain_text('No unanswered Source Observation challenges')
        expect(a.locator('#sheet')).to_contain_text('SOURCE OBSERVATION REGISTER')
        expect(a.locator('#sheet')).to_contain_text('AUTHOR RESPONSE RETAINED')
        expect(a.locator('#sheet')).to_contain_text(response_text)
        expect(a.locator('#sheet')).to_contain_text('Source observation challenged')
        expect(a.locator('#sheet')).to_contain_text('Author response to source challenge')
        expect(a.locator('#sheet')).to_contain_text('DISSENT & RESPONSE')
        a.screenshot(path=str(out/'source-observation-response-docket-answered.png'))
        docket_after_answered_view=read_state(visitor)
        assert docket_after_answered_view['world']['revision']==docket_before_answered_view['world']['revision'], 'Viewing the answered docket must not append a world event'
        assert docket_after_answered_view['world']['xp']==docket_before_answered_view['world']['xp'], 'Viewing the answered docket must not award XP'
        close_sheet(a)
        close_sheet(a);a.locator('#character-button').click()
        expect(a.locator('#sheet')).to_contain_text('Challenger')
        expect(a.locator('#sheet')).to_contain_text('1 recorded')
        close_sheet(a)
        a.locator('#journal-button').click()
        a.locator('#institution-projects').click()
        expect(a.locator('#sheet')).to_contain_text('DISSENT & CHALLENGE')
        expect(a.locator('#sheet')).to_contain_text('Source observation challenged')
        expect(a.locator('#sheet')).to_contain_text('Author response to source challenge')
        expect(a.locator('#sheet')).to_contain_text('DISSENT & RESPONSE')
        close_sheet(a)
        visit(a,'The shared observatory')
        note='<script>not code</script> Witness — こんにちは 🌍'
        b.locator('#contribution-text').fill(note);b.locator('#contribute-button').click()
        a.locator('#creation-notes').get_by_text(note,exact=True).wait_for()
        assert a.locator('#creation-notes script').count()==0
        b.get_by_text('Report a problem or unsupported claim',exact=True).click()
        report_text='Preserve this report against version one.'
        drop={'remaining':1,'text':report_text,'attempts':0}
        def lose_report_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if drop['remaining']>0 and payload.get('type')=='report' and payload.get('text')==drop['text']:
                route.fetch()  # The service commits; simulate the response disappearing in transit.
                drop['remaining']-=1
                drop['attempts']+=1
                route.abort()
                return
            route.continue_()
        b.route('**/api/action',lose_report_response)
        b.locator('#report-text').fill(report_text)
        b.locator('#report-button').click()
        expect(b.locator('#toast')).to_contain_text('unreachable')
        receipt=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert receipt, 'A lost response must leave the exact retry receipt on this device'
        # A local receipt is not authority: a different actor must not be able to replay it.
        b.evaluate("""raw=>{const item=JSON.parse(raw);item.actorId='not-the-original-actor';localStorage.setItem('ngl.common-ground.pending-shared-action.v1',JSON.stringify(item))}""",receipt)
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "The Relay")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('does not match the original actor')
        expect(b.locator('#relay-retry-pending-shared-action')).to_have_count(0)
        b.evaluate("window.dispatchEvent(new Event('online'))")
        b.wait_for_timeout(250)
        still_tampered=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert json.loads(still_tampered)['actorId']=='not-the-original-actor', 'reconnect must not replay a receipt under another actor'
        assert drop['attempts']==1, 'a mismatched actor receipt must not reach the server on reconnect'
        close_sheet(b)
        b.evaluate("(raw)=>localStorage.setItem('ngl.common-ground.pending-shared-action.v1',raw)",receipt)
        b.locator('#places-button').click()
        walk_to_location(b, "The Relay")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · REPORT')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        expect(b.locator('#xp-count')).to_have_text('100')
        recovered=read_state(visitor)
        assert sum(report['text']==report_text for report in recovered['world']['reports'])==1
        assert any(event.get('requestId') and event.get('actionResult',{}).get('id') for event in recovered['world']['events'] if event['type']=='report')

        # Drop two replies after the server commits. The browser's online event and
        # re-entry must replay the same receipt, not append another report.
        auto_report_text='Reconnect must replay this exact report once.'
        auto_before=read_state(visitor)
        auto_revision=auto_before['world']['revision']
        auto_xp=auto_before['world']['xp']
        auto_actor_id=auto_before['viewer']['id']
        drop['text']=auto_report_text
        drop['remaining']=2
        drop['attempts']=0
        visit(b,'The shared observatory')
        b.get_by_text('Report a problem or unsupported claim',exact=True).click()
        b.locator('#report-text').fill(auto_report_text)
        b.locator('#report-button').click()
        expect(b.locator('#toast')).to_contain_text('unreachable')
        auto_receipt=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert auto_receipt, 'A second lost response must leave its exact retry receipt'
        auto_request_id=json.loads(auto_receipt)['requestId']
        first_commit=read_state(visitor)
        assert sum(report['text']==auto_report_text for report in first_commit['world']['reports'])==1
        assert first_commit['world']['revision']==auto_revision+1
        assert first_commit['world']['xp']==auto_xp

        b.evaluate("window.dispatchEvent(new Event('online'))")
        b.wait_for_timeout(500)
        assert drop['attempts']==2 and drop['remaining']==0, 'the online event must retry the same pending request'
        second_receipt=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert json.loads(second_receipt)['requestId']==auto_request_id, 'reconnect must preserve the original request ID'
        after_online=read_state(visitor)
        assert sum(report['text']==auto_report_text for report in after_online['world']['reports'])==1
        assert after_online['world']['revision']==auto_revision+1, 'idempotent reconnect replay must not append a second event'
        assert after_online['world']['xp']==auto_xp

        b.reload(wait_until='domcontentloaded')
        b.locator('#start-shared').click()
        b.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        b.wait_for_function("()=>!localStorage.getItem('ngl.common-ground.pending-shared-action.v1')",timeout=15000)
        expect(b.locator('#toast')).to_contain_text('recovered the exact pending action')
        auto_recovered=read_state(visitor)
        assert sum(report['text']==auto_report_text for report in auto_recovered['world']['reports'])==1
        auto_events=[event for event in auto_recovered['world']['events'] if event.get('requestId')==auto_request_id]
        assert len(auto_events)==1 and auto_events[0]['type']=='report', auto_events
        assert auto_events[0].get('actionResult',{}).get('id'), auto_events
        assert auto_recovered['world']['revision']==auto_revision+1
        assert auto_recovered['world']['xp']==auto_xp
        assert auto_recovered['viewer']['id']==auto_actor_id and auto_recovered['viewer']['role']=='witness', 'shared re-entry must preserve the original Witness identity'
        b.unroute('**/api/action',lose_report_response)
        # Safe retry closes the Journal; reach the bounded adversary through the world Guild Hall.
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "Guild Hall")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'")
        expect(b.locator('#contradiction-clerk-npc')).to_contain_text('BOUNDED ADVERSARY')
        expect(b.locator('#contradiction-clerk-npc')).to_contain_text('No AI/provider call occurs')
        expect(b.get_by_role('button',name='Enter Council Chamber →',exact=True)).to_have_count(1)
        b.get_by_role('button',name='Challenge The shared observatory · v1 →',exact=True).click()
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='The shared observatory'")
        expect(b.locator('#contradiction-form')).to_be_visible()
        b.locator('#contradiction-claim').fill('The receipt proves the claim is true.')
        b.locator('#contradiction-source').fill('The preserved HTML bytes and the cited source page.')
        b.locator('#contradiction-falsifier').fill('A source that contradicts the claim or a failed reproduction.')
        b.locator('#contradiction-unknown').fill('Whether the source supports the wording; compare the exact passage.')
        b.locator('#contradiction-submit').click()
        b.locator('#creation-notes').get_by_text('CONTRADICTION CLERK · STRUCTURED CHALLENGE',exact=False).wait_for()
        challenge_snapshot=read_state(visitor)
        structured=[r for r in challenge_snapshot['world']['reports'] if r.get('text','').startswith('CONTRADICTION CLERK · STRUCTURED CHALLENGE')]
        assert len(structured)==1 and structured[0]['version']==1, structured
        assert 'REPORT ONLY — NOT A VERDICT' in structured[0]['text']
        assert 'no AI/provider call or independent observation occurred' in structured[0]['text']
        assert challenge_snapshot['world']['xp']==100, 'A structured report must not award XP'
        # TownSquare makes the retained report a navigable world object, not a detached dashboard row.
        close_sheet(b);b.locator('#journal-button').click()
        b.locator('#institution-projects').click()
        expect(b.locator('#sheet')).to_contain_text('TOWNSQUARE · WORLD CHRONICLE')
        challenge_card=b.locator('[data-record-type="WORLD_EVENT"]').filter(has_text='CONTRADICTION CLERK · STRUCTURED CHALLENGE')
        expect(challenge_card).to_have_count(1)
        challenge_card.get_by_role('button',name='Inspect The shared observatory · v1').click()
        expect(b.locator('#sheet-title')).to_have_text('The shared observatory')
        expect(b.locator('#version-select')).to_have_value('1')
        close_sheet(b)
        # Evidence Archive is a world destination for canonical work stages, not only user notes.
        b.locator('#places-button').click()
        walk_to_location(b, "Evidence Archive")
        b.wait_for_function("()=>document.querySelector('#sheet-title').textContent==='Evidence Archive'")
        expect(b.locator('#sheet')).to_contain_text('CANONICAL INSTITUTIONAL HISTORY')
        expect(b.locator('#sheet')).to_contain_text('OBSERVE')
        expect(b.locator('#sheet')).to_contain_text('ADJUDICATE')
        expect(b.locator('#sheet')).to_contain_text('Local byte check: passed')
        close_sheet(b)
        a.locator('#repair-button').click();a.locator('#publish-button').wait_for()
        assert visitor.request.get(url+f'api/artifacts/{creation_id}').text()==original
        a.locator('#publish-button').click()
        b.wait_for_function("()=>document.querySelector('#xp-count').textContent==='200'")
        snapshot=read_state(visitor)
        assert snapshot['world']['creations'][0]['version']==2 and len(snapshot['world']['methods'])==1
        assert len(snapshot['institution']['kernel']['accepted'])==2
        assert visitor.request.get(url+f'api/artifacts/{creation_id}?version=1').text()==original
        # A different attributed actor can preserve dissent against a self-reported experiment; this is not adjudication.
        moonshot_response=visitor.request.post(url+'api/action',data={
            'type':'propose-moonshot','title':'Can the shared observation be reproduced?',
            'hypothesis':'The observation repeats under the stated conditions.',
            'falsifier':'A controlled repeat fails to reproduce it.',
            'evidenceNeeded':'The procedure, retained artifact and a repeatable measurement.',
            'sourceCreationId':creation_id,'sourceVersion':2,'requestId':'browser-moonshot-proposal'
        })
        assert moonshot_response.status==200, moonshot_response.text()
        moonshot_id=moonshot_response.json()['result']['moonshotId']
        experiment_response=visitor.request.post(url+'api/action',data={
            'type':'report-experiment','moonshotId':moonshot_id,
            'procedure':'Repeat the documented comparison.',
            'observation':'The measurement settings are missing from the record.',
            'reportedOutcome':'inconclusive','evidenceCreationId':creation_id,'evidenceVersion':2,
            'requestId':'browser-experiment-report'
        })
        assert experiment_response.status==200, experiment_response.text()
        # Quest evidence is a deterministic projection: linkage is not truth or XP.
        # The Witness must inspect and open the exact retained version.
        evidence_objective=b.locator('[data-objective-id="witness-experiment-evidence"]')
        expect(evidence_objective).to_contain_text('RECORDED')
        expect(evidence_objective).to_contain_text('1/1')
        expect(evidence_objective).to_contain_text('Linkage only: this records a report-to-version reference.')
        expect(evidence_objective).to_contain_text('It does not verify the procedure, observation, outcome, or hypothesis.')
        evidence_objective.get_by_text('Inspect retained evidence',exact=True).click()
        expect(evidence_objective).to_contain_text('creation '+creation_id)
        expect(evidence_objective).to_contain_text('version 2')
        evidence_objective.get_by_role('button',name='Open retained version 2 →',exact=True).click()
        expect(b.locator('#sheet-title')).to_have_text('The shared observatory')
        expect(b.locator('#version-select')).to_have_value('2')
        close_sheet(b)
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Moonshot Field")
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Moonshot Field')
        a.get_by_role('button',name='Challenge this report →',exact=True).click()
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Challenge experiment report')
        a.locator('#experiment-challenge-type').select_option('missing-evidence')
        a.locator('#experiment-challenge-evidence-source').select_option(creation_id)
        assert a.locator('#experiment-challenge-evidence-version').input_value()=='2'
        a.locator('#experiment-challenge-text').fill('The report omits the measurement settings needed to reproduce the attempt.')
        a.locator('#challenge-experiment-report').click()
        expect(a.locator('#sheet')).to_contain_text('DISSENT · NOT ADJUDICATED')
        expect(a.locator('#sheet')).to_contain_text('measurement settings needed to reproduce')
        expect(a.locator('#sheet')).to_contain_text('Inspect challenge evidence v2')
        challenge_state=read_state(visitor)
        retained_challenges=[event for event in challenge_state['world']['events'] if event['type']=='experiment-challenged']
        assert len(retained_challenges)==1 and retained_challenges[0]['moonshotId']==moonshot_id
        assert retained_challenges[0]['evidenceCreationId']==creation_id and retained_challenges[0]['evidenceVersion']==2
        assert 'outcome' not in retained_challenges[0] and 'status' not in retained_challenges[0]
        pre_guild_challenge=a.locator('[data-objective-id="founder-challenge-experiment-report"]')
        expect(pre_guild_challenge).to_contain_text('RECORDED')
        expect(pre_guild_challenge).to_contain_text('Challenge another actor’s experiment report')

        # The Founder authored the challenge, not the Witness's experiment report.
        # Only the original report author receives the response control.
        close_sheet(a)
        a.locator('#places-button').click()
        walk_to_location(a, "Moonshot Field")
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='Moonshot Field')
        expect(a.get_by_role('button',name='Respond to this challenge →',exact=True)).to_have_count(0)
        close_sheet(a)

        # Re-enter the same Witness session so the response UI is hydrated from the
        # shared server history, not from another page's in-memory world object.
        b.reload(wait_until='domcontentloaded')
        b.locator('#start-shared').click()
        b.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        b.locator('#places-button').click()
        walk_to_location(b, "Moonshot Field")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='Moonshot Field')
        response_button=b.get_by_role('button',name='Respond to this challenge →',exact=True)
        expect(response_button).to_be_visible()

        response_text='The missing control is a valid limitation. I cannot claim the attempt was reproduced; a follow-up must retain the measurement settings.'
        response_before=read_state(visitor)
        response_revision=response_before['world']['revision']
        response_xp=response_before['world']['xp']
        challenge_id=retained_challenges[0]['challengeId']
        report_id=retained_challenges[0]['reportId']
        response_drop={'remaining':1,'attempts':0}
        def lose_experiment_author_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if (response_drop['remaining']>0 and
                payload.get('type')=='respond-experiment-challenge' and
                payload.get('challengeId')==challenge_id):
                route.fetch()  # Commit on the server, then simulate a lost reply in transit.
                response_drop['remaining']-=1
                response_drop['attempts']+=1
                route.abort()
                return
            route.continue_()
        b.route('**/api/action',lose_experiment_author_response)
        response_button.click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='Respond to experiment challenge')
        b.locator('#experiment-challenge-response-text').fill(response_text)
        b.locator('#respond-experiment-challenge').click()
        expect(b.locator('#toast')).to_contain_text('unreachable')
        pending_response=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert pending_response, 'A committed response with a lost reply must leave an exact local retry receipt'
        pending_response_record=json.loads(pending_response)
        pending_response_request_id=pending_response_record['requestId']
        assert pending_response_record['actorId']==witness_id, 'The local retry receipt must remain bound to the original report author'

        committed_response=read_state(visitor)
        committed_response_events=[event for event in committed_response['world']['events']
            if event['type']=='experiment-challenge-responded' and event.get('challengeId')==challenge_id]
        assert len(committed_response_events)==1, committed_response_events
        committed_response_event=committed_response_events[0]
        assert committed_response_event['actor']['id']==witness_id and committed_response_event['actor']['role']=='witness'
        assert committed_response_event['reportId']==report_id and committed_response_event['moonshotId']==moonshot_id
        assert committed_response_event['responseText']==response_text
        assert committed_response_event['requestId']==pending_response_request_id
        assert committed_response_event['actionResult']['responseId']==committed_response_event['responseId']
        assert 'status' not in committed_response_event and 'outcome' not in committed_response_event
        assert committed_response['world']['revision']==response_revision+1
        assert committed_response['world']['xp']==response_xp

        # Retry the exact retained request through the in-world Relay.
        close_sheet(b);b.locator('#places-button').click()
        walk_to_location(b, "The Relay")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · RESPOND-EXPERIMENT-CHALLENGE')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        assert not b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'Exact experiment-response retry must clear the pending receipt'
        after_response_retry=read_state(visitor)
        after_response_retry_owner=read_state(owner)
        assert after_response_retry_owner['world']['revision']==after_response_retry['world']['revision']
        assert after_response_retry_owner['world']['xp']==response_xp
        retried_response_events=[event for event in after_response_retry['world']['events']
            if event['type']=='experiment-challenge-responded' and event.get('challengeId')==challenge_id]
        assert len(retried_response_events)==1, retried_response_events
        assert retried_response_events[0]['id']==committed_response_event['id']
        assert retried_response_events[0]['responseId']==committed_response_event['responseId']
        assert_navigation_only_discovers(committed_response,after_response_retry,'The Relay retry navigation')
        assert after_response_retry['world']['xp']==response_xp
        assert response_drop['attempts']==1 and response_drop['remaining']==0
        b.unroute('**/api/action',lose_experiment_author_response)

        # Both participants can inspect the retained response, but neither view
        # promotes it into adjudication, independent verification, or XP.
        b.locator('#places-button').click()
        walk_to_location(b, "Moonshot Field")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='Moonshot Field')
        expect(b.locator('#sheet')).to_contain_text('AUTHOR RESPONSE · NOT ADJUDICATION')
        expect(b.locator('#sheet')).to_contain_text(response_text)
        expect(b.get_by_role('button',name='Respond to this challenge →',exact=True)).to_have_count(0)
        close_sheet(b)
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Evidence Archive")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(a.locator('#sheet')).to_contain_text('AUTHOR RESPONSE · NOT ADJUDICATION')
        expect(a.locator('#sheet')).to_contain_text(response_text)
        archive_inspection=read_state(owner)
        assert_navigation_only_discovers(after_response_retry_owner,archive_inspection,'Evidence Archive inspection')
        close_sheet(a)

        # The report author receives a deterministic Character skill from the
        # uniquely linked response; this is recorded activity, not XP or mastery.
        b.locator('#character-button').click()
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Character & field record'")
        witness_response_skill=b.locator('[data-skill-id="experiment-responder"]')
        expect(witness_response_skill).to_have_count(1)
        expect(witness_response_skill).to_contain_text('1 recorded original-author responses')
        expect(witness_response_skill).to_contain_text('not truth, reproduction, adjudication, approval, or XP')
        expect(witness_response_skill).to_contain_text('grants no NGL authority')
        witness_character_state=read_state(visitor)
        assert_navigation_only_discovers(after_response_retry,witness_character_state,'Witness Character Sheet inspection')
        close_sheet(b)

        # The AOTA Codex must project this same response against the Witness's
        # own report, with an answered count but no verification/adjudication.
        b.locator('#places-button').click()
        walk_to_location(b, "Polymath Academy")
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='Polymath Academy')
        codex=b.locator('[data-charter-codex="true"]')
        expect(codex).to_have_count(1)
        codex.locator('summary').click()
        verify_stage=codex.locator('[data-charter-stage="verify"]')
        expect(verify_stage).to_contain_text('CHALLENGE + AUTHOR RESPONSE RETAINED')
        expect(verify_stage).to_contain_text('CHALLENGES ON YOUR EXPERIMENT REPORTS 1 (ANSWERED 1 · UNANSWERED 0 · AMBIGUOUS 0)')
        expect(verify_stage).to_contain_text('Linked dissent (not adjudicated)')
        expect(verify_stage).to_contain_text('Retained challenge and response event IDs')
        expect(verify_stage).not_to_contain_text('VERIFIED')
        witness_codex_state=read_state(visitor)
        assert_navigation_only_discovers(after_response_retry,witness_codex_state,'Polymath Academy Codex inspection')
        close_sheet(b)

        # The response is a real actor-scoped quest objective. Its evidence
        # links back to the response object rather than upgrading the reply.
        b.locator('#places-button').click()
        walk_to_location(b, "Quest Board")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Quest Board'")
        witness_hud_response_quest=b.locator('#quest-trail [data-objective-id="witness-experiment-challenge-response"]')
        expect(witness_hud_response_quest).to_have_count(1)
        expect(witness_hud_response_quest).to_contain_text('RECORDED')
        witness_response_quest=b.locator('#sheet [data-objective-id="witness-experiment-challenge-response"]')
        expect(witness_response_quest).to_have_count(1)
        expect(witness_response_quest.locator('.quest-step-state')).to_have_text('RECORDED')
        expect(witness_response_quest).to_contain_text('1/1')
        expect(witness_response_quest).to_contain_text(committed_response_event['id'])
        witness_response_quest.locator('details.quest-evidence summary').click()
        inspect_author_response=witness_response_quest.get_by_role('button',name='Inspect author response →',exact=True)
        expect(inspect_author_response).to_have_count(1)
        inspect_author_response.click()
        def inspect_response_activity(page):
            # The quest-evidence action starts a destination-specific route. The
            # generic Interact control sends a distant player to The Making Bench,
            # replacing that route; wait for the route-completion callback instead.
            try:
                page.wait_for_function(
                    "()=>document.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&!document.querySelector('#sheet').hidden",
                    timeout=30000
                )
            except Exception as error:
                state=page.evaluate("""()=>({
                    title:document.querySelector('#sheet-title')?.textContent||null,
                    sheetHidden:document.querySelector('#sheet')?.hidden??null,
                    portalHidden:document.querySelector('#portal')?.hidden??null,
                    modalOpen:document.body.classList.contains('modal-open'),
                    activeQuestTarget:document.querySelector('#world')?.dataset.activeQuestTarget||null,
                    questCompass:document.querySelector('#world')?.dataset.questCompass||null,
                    interactLabel:document.querySelector('#interact-button')?.textContent||null
                })""")
                raise AssertionError('The destination-specific route did not open the retained author-response map object; state='+str(state)) from error
        inspect_response_activity(b)
        response_card=b.locator('[data-research-activity-id="'+committed_response_event['responseId']+'"]')
        expect(response_card).to_contain_text('AUTHOR RESPONSE · NOT ADJUDICATION')
        expect(response_card).to_contain_text(response_text)
        quest_inspection_state=read_state(visitor)
        # Reaching the exact map object can discover a landmark, but cannot
        # append another response, adjudication, or other research event.
        assert_navigation_only_discovers(after_response_retry,quest_inspection_state,'Quest-evidence response navigation')
        quest_inspection_response_events=[event for event in quest_inspection_state['world']['events']
            if event['type']=='experiment-challenge-responded' and event.get('challengeId')==challenge_id]
        assert len(quest_inspection_response_events)==1, quest_inspection_response_events
        assert quest_inspection_response_events[0]['id']==committed_response_event['id']
        assert quest_inspection_response_events[0]['responseId']==committed_response_event['responseId']
        assert quest_inspection_state['world']['xp']==response_xp
        close_sheet(b)

        # The response also exists as a distinct walkable research object in
        # the Moonshot Field trail, not merely as nested text in the report card.
        b.locator('#places-button').click()
        expect(b.locator('#sheet')).to_contain_text('AUTHOR RESPONSE · NOT ADJUDICATION')
        response_world_object=b.get_by_role('button',name='Inspect research record: Author response · not adjudication',exact=True)
        expect(response_world_object).to_have_count(1)
        expect(response_world_object).to_contain_text('walk to map object')
        expect(response_world_object).to_contain_text(response_text[:80])
        response_world_object.click()
        inspect_response_activity(b)
        response_card=b.locator('[data-research-activity-id="'+committed_response_event['responseId']+'"]')
        expect(response_card).to_contain_text('AUTHOR RESPONSE · NOT ADJUDICATION')
        expect(response_card).to_contain_text(response_text)
        close_sheet(b)

        # The challenge author has no personal response objective to inherit.
        # The Founder did not author the challenged report in this journey.
        a.locator('#places-button').click()
        walk_to_location(a, "Quest Board")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Quest Board'")
        founder_hud_response_quest=a.locator('#quest-trail [data-objective-id="founder-experiment-challenge-response"]')
        expect(founder_hud_response_quest).to_have_count(1)
        expect(founder_hud_response_quest).to_contain_text('OPEN')
        founder_response_quest=a.locator('#sheet [data-objective-id="founder-experiment-challenge-response"]')
        expect(founder_response_quest).to_have_count(1)
        expect(founder_response_quest.locator('.quest-step-state')).to_have_text('OPEN')
        expect(founder_response_quest).to_contain_text('0/1')
        expect(founder_response_quest).to_contain_text('Another actor must retain a valid challenge')
        founder_quest_state=read_state(owner)
        assert_navigation_only_discovers(after_response_retry_owner,founder_quest_state,'Founder Quest Board inspection')
        close_sheet(a)

        # The challenge author and an unrelated role must not inherit the
        # original report author's response skill.
        a.reload(wait_until='domcontentloaded')
        a.locator('#start-shared').click()
        a.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Founder')")
        a.locator('#character-button').click()
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Character & field record'")
        founder_response_skill=a.locator('[data-skill-id="experiment-responder"]')
        expect(founder_response_skill).to_have_count(1)
        expect(founder_response_skill).to_contain_text('0 recorded original-author responses')
        founder_character_state=read_state(owner)
        assert_navigation_only_discovers(after_response_retry_owner,founder_character_state,'Founder Character Sheet inspection')
        close_sheet(a)

        # Exercise the Guild NPC workbench through the shared Relay, not only in private mode.
        # Close the preceding challenge sheet before using the hidden accessible NPC control:
        # the control is deliberately disabled while any modal is open.
        close_sheet(a)
        a.wait_for_function("()=>!document.body.classList.contains('modal-open')&&document.querySelector('#play-ui')?.hidden===false")
        # Compare each actor's own read model before/after. Founder and Witness
        # projections intentionally differ: non-Founders cannot see draft/repair
        # events or another actor's private message-reported event.
        before_npc_state=read_state(owner)
        assert before_npc_state['viewer']['role']=='founder'
        before_npc_witness_state=read_state(visitor)
        assert before_npc_witness_state['viewer']['role']=='witness'
        before_npc_revision=before_npc_state['world']['revision']
        before_npc_events=before_npc_state['world']['events']
        before_npc_witness_events=before_npc_witness_state['world']['events']
        before_npc_xp=before_npc_state['world']['xp']
        assert before_npc_witness_state['world']['revision']==before_npc_revision
        assert before_npc_witness_state['world']['xp']==before_npc_xp
        adversary_control=a.locator('[data-guild-npc-control="adversary"]')
        expect(adversary_control).to_have_count(1)
        expect(adversary_control).to_be_enabled()
        # The Founder approaches the actual Adversary sprite, explicitly talks, and receives
        # only that role's source-bound packet.
        adversary_control.evaluate("(button)=>button.click()")
        a.wait_for_function("()=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl==='adversary'&&button.dataset.guildNpcAction==='talk')",timeout=60000)
        expect(adversary_control).to_have_attribute('data-guild-npc-action','talk')
        adversary_control.evaluate("(button)=>button.click()")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        after_npc_state=read_state(owner)
        after_npc_witness_state=read_state(visitor)
        assert after_npc_state['world']['revision']==before_npc_revision, 'NPC navigation/talk must not create a canonical revision'
        assert after_npc_state['world']['events']==before_npc_events, 'NPC navigation/talk must not append a canonical event'
        assert after_npc_state['world']['xp']==before_npc_xp, 'NPC navigation/talk must not award XP'
        assert after_npc_witness_state['world']['revision']==before_npc_revision, 'NPC navigation/talk must not change the Witness world revision'
        assert after_npc_witness_state['world']['events']==before_npc_witness_events, 'NPC navigation/talk must not change the Witness-visible event projection'
        assert after_npc_witness_state['world']['xp']==before_npc_xp, 'NPC navigation/talk must not award XP to the Witness view'
        adversary_packet=a.locator('[data-collaborator-role="adversary"]')
        expect(adversary_packet).to_be_visible()
        adversary_packet.locator('details.collaborator-packet summary').click()
        handoff=adversary_packet.locator('textarea[aria-label$="hand-off packet"]').input_value()
        handoff_payload=json.loads(handoff.split('UNTRUSTED_INPUT_JSON:\n',1)[1])
        target_event=next(record['eventId'] for record in handoff_payload['inputRecords'] if record['type']=='experiment-reported')
        collaborator_response={
            'targetEventId':target_event,
            'challengeType':'methodology',
            'challengeDraft':'The report does not specify the measurement control needed to reproduce the attempt.',
            'distinctnessAssessment':'A bounded draft for human review against the exact supplied report and prior challenges.',
            'duplicateOfEventIds':[],
            'counterexample':'A controlled comparison could produce a different result.',
            'evidenceNeeded':['A retained controlled replication with its measurement settings.'],
            'unknowns':['No independent measurement or replication is supplied.']
        }
        collaborator_response_text=json.dumps(collaborator_response)
        adversary_packet.locator('details.collaborator-response summary').click()
        collaborator_response_field=adversary_packet.locator('textarea[aria-label="Adversary response JSON"]')
        collaborator_response_field.fill(collaborator_response_text)
        adversary_packet.get_by_role('button',name='Validate response for review',exact=True).click()
        expect(adversary_packet.locator('[data-collaborator-response-status="adversary"]')).to_contain_text('STRUCTURE VALID')
        before_collaborator=read_state(owner)
        assert before_collaborator['viewer']['role']=='founder'
        founder_id=before_collaborator['viewer']['id']
        before_collaborator_revision=before_collaborator['world']['revision']
        before_collaborator_xp=before_collaborator['world']['xp']
        lost_collaborator={'remaining':True,'payload':None,'response':None}
        def lose_collaborator_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if lost_collaborator['remaining'] and payload.get('type')=='record-collaborator-response':
                lost_collaborator['payload']=payload
                committed=route.fetch()
                lost_collaborator['response']=committed.json()
                assert committed.status==200, 'The service must commit the collaborator response before simulated response loss'
                lost_collaborator['remaining']=False
                route.fulfill(status=503,content_type='application/json',body=json.dumps({
                    'error':{'code':'SIMULATED_RESPONSE_LOSS','message':'Collaborator response lost after commit.'}
                }))
                return
            route.continue_()
        a.route('**/api/action',lose_collaborator_response)
        adversary_packet.get_by_role('button',name='Archive exact response as untrusted history →',exact=True).click()
        expect(a.locator('#toast')).to_contain_text('Collaborator response lost after commit')
        pending_collaborator_raw=a.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert pending_collaborator_raw, 'A committed collaborator response with a lost response must retain its exact Relay receipt'
        pending_collaborator=json.loads(pending_collaborator_raw)
        assert pending_collaborator['actorId']==founder_id and pending_collaborator['actorRole']=='founder'
        assert pending_collaborator['action']['type']=='record-collaborator-response'
        assert pending_collaborator['action']['role']=='adversary'
        assert pending_collaborator['action']['responseText']==collaborator_response_text
        assert pending_collaborator['requestId']==lost_collaborator['payload']['requestId']
        committed_collaborator=read_state(visitor)
        committed_responses=[event for event in committed_collaborator['world']['events'] if event['type']=='collaborator-response-recorded']
        assert len(committed_responses)==1, 'Independent state read must observe exactly one committed collaborator response'
        committed_response=committed_responses[0]
        assert committed_response['actor']['id']==founder_id and committed_response['actor']['role']=='founder'
        assert committed_response['role']=='adversary'
        assert committed_response['responseText']==collaborator_response_text
        assert committed_response['validationStatus']=='valid-for-human-review'
        assert committed_response['requestId']==pending_collaborator['requestId']
        assert committed_collaborator['world']['revision']==before_collaborator_revision+1
        assert committed_collaborator['world']['xp']==before_collaborator_xp, 'Archiving a collaborator response must not award XP'
        a.unroute('**/api/action',lose_collaborator_response)
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "The Relay")
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(a.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(a.locator('#relay-pending-action')).to_contain_text('Pending action · RECORD-COLLABORATOR-RESPONSE')
        a.locator('#relay-retry-pending-shared-action').click()
        expect(a.locator('#sheet')).to_be_hidden()
        assert not a.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'Exact collaborator-response retry must clear the pending receipt'
        recovered_collaborator=read_state(visitor)
        recovered_responses=[event for event in recovered_collaborator['world']['events'] if event['type']=='collaborator-response-recorded']
        assert len(recovered_responses)==1, 'Exact retry must not append a duplicate collaborator response'
        assert recovered_collaborator['world']['revision']==committed_collaborator['world']['revision']
        assert recovered_collaborator['world']['xp']==before_collaborator_xp
        assert recovered_responses[0]['responseId']==committed_response['responseId']
        assert recovered_responses[0]['requestId']==pending_collaborator['requestId']
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "Evidence Archive")
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(a.locator('#sheet')).to_contain_text('BOUNDED COLLABORATOR RESPONSES')
        expect(a.locator('#sheet')).to_contain_text('STRUCTURE VALID · HUMAN REVIEW ONLY')
        a.locator('details.collaborator-response summary').filter(has_text='Inspect exact pasted response').click()
        archived_collaborator_field=a.locator('textarea[aria-label="Archived collaborator response"]')
        expect(archived_collaborator_field).to_have_count(1)
        assert archived_collaborator_field.input_value()==collaborator_response_text
        expect(a.locator('[data-objective-id="founder-guild-response"]')).to_contain_text('RECORDED')
        coverage_quest=a.locator('[data-objective-id="founder-guild-council-coverage"]')
        expect(coverage_quest).to_contain_text('1/4')
        council_before_owner=read_state(owner)
        council_before_witness=read_state(visitor)
        a.get_by_role('button',name='Enter Council Chamber →',exact=True).click()
        expect(a.locator('#sheet-title')).to_have_text('Council Chamber')
        expect(a.locator('[data-council-coverage-progress="1/4"]')).to_have_count(1)
        expect(a.locator('[data-council-next-role="guild-npc-archivist"]')).to_have_count(1)
        adversary_slot=a.locator('[data-council-role="adversary"]')
        expect(adversary_slot).to_have_attribute('data-council-status','human-review')
        expect(adversary_slot).to_have_attribute('data-council-event-id',committed_response['id'])
        expect(adversary_slot).to_have_attribute('data-council-response-id',committed_response['responseId'])
        for missing_role in ['archivist','synthesizer','tutor']:
            expect(a.locator(f'[data-council-role="{missing_role}"]')).to_have_attribute('data-council-status','awaiting')
        expect(a.locator('#sheet')).to_contain_text('not consensus')
        expect(a.locator('#sheet')).to_contain_text('or authority')
        expect(a.locator('#sheet')).to_contain_text('Consequential decisions remain in the human-gated Decision Chamber')
        council_review=adversary_slot.locator('details[data-council-review-summary="adversary"]')
        expect(council_review).to_have_count(1)
        assert not council_review.evaluate('(details)=>details.open'), 'Council review notes must be collapsed by default'
        council_review.locator('summary').click()
        expect(council_review).to_contain_text('structural/scope revalidation for human review only')
        expect(council_review).to_contain_text('The report does not specify the measurement control needed to reproduce the attempt.')
        expect(council_review).to_contain_text('No independent measurement or replication is supplied.')
        expect(council_review).to_contain_text('Packet scope:')
        expect(council_review).to_contain_text('Included source IDs:')
        expect(council_review).to_contain_text('not independent evidence')
        a.screenshot(path=str(out/'guild-council-chamber-review.png'))
        adversary_slot.get_by_role('button',name='Inspect exact retained response →',exact=True).click()
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        focused_response_card=a.locator('[data-council-response-focus="true"]')
        expect(focused_response_card).to_have_count(1)
        expect(focused_response_card).to_be_visible()
        expect(focused_response_card).to_be_focused()
        assert focused_response_card.get_attribute('data-collaborator-response-id')==committed_response['responseId']
        focused_response_card.locator('details.collaborator-response summary').click()
        focused_response_field=focused_response_card.locator('textarea[aria-label="Archived collaborator response"]')
        expect(focused_response_field).to_have_count(1)
        assert focused_response_field.input_value()==collaborator_response_text
        council_after_owner=read_state(owner)
        council_after_witness=read_state(visitor)
        assert council_after_owner['world']['revision']==council_before_owner['world']['revision']
        assert council_after_owner['world']['events']==council_before_owner['world']['events']
        assert council_after_owner['world']['xp']==council_before_owner['world']['xp']
        assert council_after_witness['world']['revision']==council_before_witness['world']['revision']
        assert council_after_witness['world']['events']==council_before_witness['world']['events']
        assert council_after_witness['world']['xp']==council_before_witness['world']['xp']
        close_sheet(a)
        character_before=read_state(visitor)['world']
        a.locator('#character-button').click()
        expect(a.locator('#sheet-title')).to_have_text('Character & field record')
        expect(a.locator('#sheet')).to_contain_text('Collaborator')
        expect(a.locator('#sheet')).to_contain_text('1 recorded bounded collaborator-response attempts')
        expect(a.locator('#sheet')).to_contain_text('Council')
        expect(a.locator('#sheet')).to_contain_text('1 recorded distinct Guild Hall role attempts')
        expect(a.locator('#sheet')).to_contain_text('Rejected responses remain preserved attempts, not endorsements')
        character_after=read_state(visitor)['world']
        assert character_after['revision']==character_before['revision'] and character_after['xp']==character_before['xp'], \
            'Character skill inspection must be a read-only projection of the retained response'
        close_sheet(a)
        coverage_quest.get_by_role('button',name='Go do this →',exact=True).click()
        a.wait_for_function("()=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl==='archivist'&&button.dataset.guildNpcAction==='talk')")
        assert read_state(visitor)['world']['revision']==recovered_collaborator['world']['revision'], 'Quest navigation to the next role must remain read-only'
        def talk_to_council_npc(page, role):
            expected_sheet={
                'archivist':'Evidence Archive',
                'synthesizer':'Guild Hall',
                'tutor':'Polymath Academy'
            }[role]
            page.wait_for_function(
                "()=>!document.body.classList.contains('modal-open')&&document.querySelector('#play-ui')?.hidden===false",
                timeout=30000
            )
            control=page.locator(f'[data-guild-npc-control="{role}"]')
            expect(control).to_have_count(1)
            expect(control).to_be_enabled()
            if control.get_attribute('data-guild-npc-action')!='talk':
                control.evaluate("(button)=>button.click()")
                page.wait_for_function(
                    f"()=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl==='{role}'&&button.dataset.guildNpcAction==='talk')",
                    timeout=60000
                )
                control=page.locator(f'[data-guild-npc-control="{role}"]')
            expect(control).to_have_attribute('data-guild-npc-action','talk')
            control.evaluate("(button)=>button.click()")
            try:
                page.wait_for_function(
                    "(expected)=>document.querySelector('#sheet-title')?.textContent===expected&&!document.querySelector('#sheet').hidden",
                    arg=expected_sheet,timeout=30000
                )
            except Exception as error:
                page.screenshot(path=str(out/f'failed-council-{role}-workbench.png'))
                actual=page.locator('#sheet-title').text_content()
                raise AssertionError(
                    f'{role} NPC did not open {expected_sheet}; current sheet title={actual!r}'
                ) from error
            packet=page.locator(f'[data-collaborator-role="{role}"]')
            expect(packet).to_be_visible()
            return packet

        def make_council_response(role, payload):
            # Deterministic acceptance fixture: derive every citation from this exact
            # bounded packet. It is retained as untrusted collaborator output, not truth.
            records = payload.get('inputRecords')
            if not isinstance(records, list):
                raise AssertionError('Council response fixture requires the exact bounded packet records.')

            if role == 'archivist':
                included_ids = [
                    record['eventId'] for record in records
                    if isinstance(record, dict) and isinstance(record.get('eventId'), str)
                ]
                omitted_count = payload.get('omittedCount', 0)
                return {
                    'eventChainFindings': [
                        'Reviewed only supplied event IDs: ' + ', '.join(included_ids) + '.',
                        'Packet disclosure reports ' + str(omitted_count) + ' omitted activity record(s).'
                    ],
                    'claims': [
                        'Retained report text is actor-authored and remains unverified.'
                    ],
                    'linkageIssues': [],
                    'unknowns': [
                        'No independent source retrieval or measurement is present in this packet.'
                    ],
                    'nextChecks': [
                        'Compare the supplied event IDs and receipts with retained history before claiming exhaustive chronology.'
                    ]
                }

            if role == 'adversary':
                report = next((
                    record for record in records
                    if isinstance(record, dict) and record.get('type') == 'experiment-reported'
                ), None)
                if report is None:
                    raise AssertionError('Adversary fixture requires an included experiment report.')
                return {
                    'targetEventId': report['eventId'],
                    'challengeType': 'methodology',
                    'challengeDraft': 'The report does not describe a control condition.',
                    'distinctnessAssessment': 'This draft asks for a missing control not established by the supplied packet.',
                    'duplicateOfEventIds': [],
                    'counterexample': '',
                    'evidenceNeeded': ['A controlled repeat that records the missing condition.'],
                    'unknowns': ['No independent measurement is present in the supplied packet.']
                }

            if role == 'synthesizer':
                report = next((
                    record for record in records
                    if isinstance(record, dict) and record.get('type') == 'experiment-reported'
                ), None)
                challenge = next((
                    record for record in records
                    if isinstance(record, dict) and record.get('type') == 'experiment-challenged'
                ), None)
                author_response = next((
                    record for record in records
                    if isinstance(record, dict) and record.get('type') == 'experiment-challenge-responded'
                ), None)
                if report is None or challenge is None or author_response is None:
                    raise AssertionError(
                        'Synthesis fixture requires the exact report, challenge, and original-author reply.'
                    )
                dissent_ids = [
                    record['eventId'] for record in records
                    if isinstance(record, dict) and record.get('type') == 'experiment-challenged'
                ]
                return {
                    'scope': {
                        'moonshotId': payload['targetMoonshotId'],
                        'includedEventIds': list(payload['inputRefs']),
                        'omittedEventIds': list(payload['omittedEventIds'])
                    },
                    'recordedSupport': [
                        {
                            'sourceEventIds': [report['eventId']],
                            'statement': 'The retained report records the original self-reported outcome.'
                        },
                        {
                            'sourceEventIds': [author_response['eventId']],
                            'statement': 'The original author supplied a separate reply; it does not adjudicate the challenge.'
                        }
                    ],
                    'contradictions': [
                        {
                            'sourceEventIds': [report['eventId'], challenge['eventId'], author_response['eventId']],
                            'statement': 'The report, challenge, and author reply remain distinct statements for human review.'
                        }
                    ],
                    'dissentPreserved': dissent_ids,
                    'unknowns': [
                        'The supplied records do not independently verify the reported observation or the reply.'
                    ],
                    'nextDiscriminatingExperiment': {
                        'procedure': 'Repeat the procedure with a recorded control and independently retained measurements.',
                        'outcome': 'Compare the controlled measurement with the reported result without treating either statement as proof.'
                    }
                }

            if role == 'tutor':
                return {
                    'concepts': ['Falsifiability', 'Control conditions', 'Observation versus inference'],
                    'prerequisites': [
                        'Distinguish an actor-authored report from an independently observed measurement.'
                    ],
                    'explanation': (
                        'A falsifier states what observation would count against a hypothesis. '
                        'A control helps distinguish the proposed cause from alternatives. '
                        'A report records what an actor says happened; it is not independent confirmation.'
                    ),
                    'questions': [
                        'What result would count against the hypothesis?',
                        'Which control would distinguish the proposed cause from an alternative explanation?'
                    ],
                    'answerKey': [
                        'A result that contradicts the stated prediction under the declared procedure.',
                        'A comparison condition that changes only the factor under investigation.'
                    ],
                    'whatRemainsUnproven': [
                        'The retained report and reply do not establish independent measurement or mastery.'
                    ]
                }

            raise AssertionError('Unexpected Council response role: ' + role)

        def archive_and_review_council_role(page, role, expected_headings, completed_roles, progress, next_role=None):
            packet=page.locator(f'[data-collaborator-role="{role}"]')
            expect(packet).to_be_visible()
            packet.locator('details.collaborator-packet summary').click()
            handoff=packet.locator('textarea[aria-label$="hand-off packet"]').input_value()
            packet_json=handoff.split('UNTRUSTED_INPUT_JSON:\n',1)[1]
            payload=json.loads(packet_json)
            assert payload['role']==role
            assert payload['authority']=='advisory-only'
            assert payload['mayWriteCanonicalState'] is False
            assert payload['mayGrantAuthority'] is False
            assert payload['mayAwardProgress'] is False
            response_data=make_council_response(role,payload)
            response_text=json.dumps(response_data,ensure_ascii=False)
            packet.locator('details.collaborator-response summary').click()
            response_field=packet.locator('textarea[aria-label$="response JSON"]')
            response_field.fill(response_text)
            packet.get_by_role('button',name='Validate response for review',exact=True).click()
            expect(packet.locator(f'[data-collaborator-response-status="{role}"]')).to_contain_text('STRUCTURE VALID')
            before=read_state(visitor)
            assert before['viewer']['role']=='witness'
            before_revision=before['world']['revision']
            before_xp=before['world']['xp']
            trace=None
            author_response=None
            if role=='synthesizer':
                author_response=next(record for record in payload['inputRecords'] if record.get('type')=='experiment-challenge-responded')
                trace=packet.locator('[data-collaborator-source-trace="synthesizer"]')
                expect(trace).to_have_count(1)
                assert not trace.evaluate('(details)=>details.open'), 'Synthesis source trace must be collapsed by default'
                trace.locator('summary').click()
                assert trace.evaluate('(details)=>details.open')
                support_link=trace.locator(
                    f'button[data-collaborator-citation-kind="support"][data-collaborator-source-event-id="{author_response["eventId"]}"]'
                )
                expect(support_link).to_have_count(1)
                contradiction_link=trace.locator(
                    f'button[data-collaborator-citation-kind="contradiction"][data-collaborator-source-event-id="{author_response["eventId"]}"]'
                )
                expect(contradiction_link).to_have_count(1)
                dissent_id=response_data['dissentPreserved'][0]
                dissent_link=trace.locator(
                    f'button[data-collaborator-citation-kind="dissent"][data-collaborator-source-event-id="{dissent_id}"]'
                )
                expect(dissent_link).to_have_count(1)
                page.screenshot(path=str(out/'guild-synthesis-source-trace.png'))
                after_trace=read_state(visitor)
                assert after_trace['world']['revision']==before_revision
                assert after_trace['world']['events']==before['world']['events']
                assert after_trace['world']['xp']==before_xp, 'Opening the Synthesis citation trace must be read-only'
            packet.get_by_role('button',name='Archive exact response as untrusted history →',exact=True).click()
            response_status=packet.locator(f'[data-collaborator-response-status="{role}"]')
            try:
                expect(response_status).to_contain_text('ARCHIVED',timeout=10000)
            except Exception as error:
                status_text=response_status.text_content()
                toast_text=page.locator('#toast').text_content()
                page.screenshot(path=str(out/f'failed-council-{role}-archive.png'))
                raise AssertionError(
                    f'{role} archive did not commit; status={status_text!r}; toast={toast_text!r}'
                ) from error
            expect(page.locator('#toast')).to_contain_text('Untrusted collaborator response preserved')
            owner_after_action=read_state(owner)
            after=read_state(visitor)
            owner_role_events=[event for event in owner_after_action['world']['events']
                if event['type']=='collaborator-response-recorded' and event['role']==role]
            role_events=[event for event in after['world']['events']
                if event['type']=='collaborator-response-recorded' and event['role']==role]
            assert len(owner_role_events)==1, (
                f'{role} Founder projection must have exactly one retained response; '
                f'found={[(event.get("role"),event.get("validationStatus"),event.get("id")) for event in owner_after_action["world"]["events"] if event.get("type")=="collaborator-response-recorded"]}'
            )
            assert len(role_events)==1, (
                f'{role} Witness projection must have exactly one retained response; '
                f'found={[(event.get("role"),event.get("validationStatus"),event.get("id")) for event in after["world"]["events"] if event.get("type")=="collaborator-response-recorded"]}'
            )
            event=role_events[0]
            assert event['actor']['id']==founder_id and event['actor']['role']=='founder'
            assert event['sourceEventIds']==payload['inputRefs']
            assert event['packetJson']==packet_json
            assert event['responseText']==response_text
            assert event['validationStatus']=='valid-for-human-review'
            assert after['world']['revision']==before_revision+1
            assert after['world']['xp']==before_xp, 'Archiving a Council response must not award XP'
            if role=='synthesizer':
                assert author_response is not None and trace is not None
                response_link=trace.locator(
                    f'button[data-collaborator-citation-kind="support"][data-collaborator-source-event-id="{author_response["eventId"]}"]'
                )
                response_link.click()
                expect(page.locator('#sheet-title')).to_have_text('Moonshot Field')
                response_card=page.locator(f'[data-research-activity-id="{author_response["responseId"]}"]')
                expect(response_card).to_be_visible()
                expect(response_card).to_contain_text('AUTHOR RESPONSE · NOT ADJUDICATION')
                expect(response_card).to_contain_text(author_response['responseText'])
                assert response_card.evaluate('(element)=>document.activeElement===element'), 'citation must focus the exact retained author-response card'
                owner_after_navigation=read_state(owner)
                visitor_after_navigation=read_state(visitor)
                assert owner_after_navigation['world']['revision']==owner_after_action['world']['revision']
                assert owner_after_navigation['world']['events']==owner_after_action['world']['events']
                assert owner_after_navigation['world']['xp']==owner_after_action['world']['xp']
                assert visitor_after_navigation['world']['revision']==after['world']['revision']
                assert visitor_after_navigation['world']['events']==after['world']['events']
                assert visitor_after_navigation['world']['xp']==after['world']['xp'], 'Following a Synthesis citation must not mutate the shared world'
                close_sheet(page)
                page.locator('#places-button').click()
                walk_to_location(page, "Guild Hall")
                page.wait_for_function(
                    "()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'&&!document.querySelector('#sheet').hidden",
                    timeout=30000
                )
            elif role=='tutor':
                close_sheet(page)
                page.locator('#places-button').click()
                walk_to_location(page, "Guild Hall")
                page.wait_for_function(
                    "()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'&&!document.querySelector('#sheet').hidden",
                    timeout=30000
                )
            page.locator('[data-enter-council-chamber]').click()
            expect(page.locator('#sheet-title')).to_have_text('Council Chamber')
            expect(page.locator(f'[data-council-coverage-progress="{progress}"]')).to_have_count(1)
            for role_id in ['archivist','adversary','synthesizer','tutor']:
                expected_status='human-review' if role_id in completed_roles else 'awaiting'
                expect(page.locator(f'[data-council-role="{role_id}"]')).to_have_attribute('data-council-status',expected_status)
            slot=page.locator(f'[data-council-role="{role}"]')
            expect(slot).to_have_attribute('data-council-event-id',event['id'])
            expect(slot).to_have_attribute('data-council-response-id',event['responseId'])
            review=slot.locator(f'details[data-council-review-summary="{role}"]')
            expect(review).to_have_count(1)
            assert not review.evaluate('(details)=>details.open'), f'{role} review notes must be collapsed by default'
            review.locator('summary').click()
            expect(review).to_contain_text('structural/scope revalidation for human review only')
            expect(review).to_contain_text('not independent evidence')
            expect(review).to_contain_text('Packet scope:')
            for heading in expected_headings:
                expect(review).to_contain_text(heading)
            if role=='synthesizer':
                for dissent_id in make_council_response(role,payload)['dissentPreserved']:
                    expect(review).to_contain_text(dissent_id)
            owner_after=read_state(owner)
            before_read=read_state(visitor)
            after_read=read_state(owner)
            assert before_read['world']['revision']==after['world']['revision']
            assert before_read['world']['events']==after['world']['events']
            assert before_read['world']['xp']==after['world']['xp']
            assert after_read['world']['revision']==owner_after['world']['revision']
            assert after_read['world']['events']==owner_after['world']['events']
            assert after_read['world']['xp']==owner_after['world']['xp']
            if next_role:
                expect(page.locator(f'[data-council-next-role="guild-npc-{next_role}"]')).to_have_count(1)
            else:
                expect(page.locator('[data-council-next-role]')).to_have_count(0)
                expect(page.locator('[data-council-coverage-progress="4/4"]')).to_contain_text('4/4 role attempts retained')
                expect(page.locator('#sheet')).to_contain_text('not consensus')
                expect(page.locator('#sheet')).to_contain_text('or authority')
            return event

        def route_to_next_council_npc(page, role):
            next_button=page.locator('[data-council-next-role]')
            expect(next_button).to_have_count(1)
            assert next_button.get_attribute('data-council-next-role')==f'guild-npc-{role}'
            next_button.click()
            page.wait_for_function(
                "()=>!document.body.classList.contains('modal-open')&&document.querySelector('#play-ui')?.hidden===false",
                timeout=30000
            )
            page.wait_for_function(
                f"()=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl==='{role}')",
                timeout=60000
            )
            return talk_to_council_npc(page,role)

        # The Adversary path above is only one of four bounded role renderers.
        # Exercise the remaining NPCs through their real map controls and retained
        # packet/response flow; each response stays untrusted and earns no XP.
        archivist_packet=talk_to_council_npc(a,'archivist')
        archive_and_review_council_role(
            a,'archivist',
            ['Event-chain findings','Claims · unverified','Linkage issues','Unknowns','Next checks'],
            ['adversary','archivist'],'2/4','synthesizer'
        )
        route_to_next_council_npc(a,'synthesizer')
        archive_and_review_council_role(
            a,'synthesizer',
            ['Recorded support · collaborator claims','Contradictions · dissent retained',
             'Dissent event IDs preserved','Suggested next experiment · not run or approved'],
            ['adversary','archivist','synthesizer'],'3/4','tutor'
        )
        route_to_next_council_npc(a,'tutor')
        archive_and_review_council_role(
            a,'tutor',
            ['Concepts','Prerequisites','Explanation · general instruction, not mastery',
             'Retrieval questions','Answer key · study aid, not mastery','What remains unproven'],
            ['adversary','archivist','synthesizer','tutor'],'4/4'
        )
        a.screenshot(path=str(out/'guild-council-four-role-dossier.png'))
        close_sheet(a)
        council_character_before=read_state(owner)['world']
        a.locator('#character-button').click()
        expect(a.locator('#sheet-title')).to_have_text('Character & field record')
        expect(a.locator('#sheet')).to_contain_text('4 recorded bounded collaborator-response attempts')
        expect(a.locator('#sheet')).to_contain_text('4 recorded distinct Guild Hall role attempts')
        council_character_after=read_state(owner)['world']
        assert council_character_after['revision']==council_character_before['revision']
        assert council_character_after['xp']==council_character_before['xp']
        close_sheet(a)

        def open_commons(page):
            close_sheet(page)
            page.locator('#places-button').click()
            walk_to_location(page, 'The Commons at TownSquare')
            page.wait_for_function(
                "()=>document.querySelector('#sheet-title')?.textContent==='The Commons at TownSquare'&&!document.querySelector('#sheet').hidden",
                timeout=30000
            )

        open_commons(a)
        before_commons=read_state(owner)
        assert before_commons['viewer']['role']=='founder'
        before_commons_revision=before_commons['world']['revision']
        before_commons_xp=before_commons['world']['xp']
        before_commons_event_ids={event['id'] for event in before_commons['world']['events']}
        before_commons_witness=read_state(visitor)
        assert before_commons_witness['viewer']['role']=='witness'
        assert before_commons_witness['world']['revision']==before_commons_revision
        commons_text='Keep the argument and the moderation record; do not turn either into evidence.'
        lost_commons={'remaining':True,'payload':None,'response':None}
        def lose_commons_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if lost_commons['remaining'] and payload.get('type')=='post-message' and payload.get('text')==commons_text:
                lost_commons['payload']=payload
                committed=route.fetch()
                lost_commons['response']=committed.json()
                assert committed.status==200, 'The Commons post must commit before simulated response loss'
                lost_commons['remaining']=False
                route.fulfill(status=503,content_type='application/json',body=json.dumps({
                    'error':{'code':'SIMULATED_RESPONSE_LOSS','message':'Commons post lost after commit.'}
                }))
                return
            route.continue_()
        a.route('**/api/action',lose_commons_response)
        a.locator('#commons-message').fill(commons_text)
        a.locator('[data-commons-post="true"]').click()
        expect(a.locator('#toast')).to_contain_text('Commons post lost after commit')
        pending_commons_raw=a.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert pending_commons_raw, 'A committed Commons post with a lost response must retain its exact Relay receipt'
        pending_commons=json.loads(pending_commons_raw)
        assert pending_commons['actorId']==before_commons['viewer']['id'] and pending_commons['actorRole']=='founder'
        assert pending_commons['action']=={'type':'post-message','text':commons_text}
        assert pending_commons['requestId']==lost_commons['payload']['requestId']
        committed_commons=read_state(visitor)
        commons_posts=[event for event in committed_commons['world']['events'] if event['type']=='message-posted']
        assert len(commons_posts)==1 and commons_posts[0]['text']==commons_text
        commons_message_id=lost_commons['response']['result']['messageId']
        assert commons_posts[0]['messageId']==commons_message_id
        assert committed_commons['world']['revision']==before_commons_revision+1
        assert committed_commons['world']['xp']==before_commons_xp, 'A Commons post must not award XP'
        a.unroute('**/api/action',lose_commons_response)
        close_sheet(a);a.locator('#places-button').click()
        walk_to_location(a, "The Relay")
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(a.locator('#relay-pending-action')).to_contain_text('Pending action · POST-MESSAGE')
        a.locator('#relay-retry-pending-shared-action').click()
        expect(a.locator('#sheet')).to_be_hidden()
        assert not a.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'Exact Commons retry must clear the pending Relay receipt'
        replayed_commons=read_state(visitor)
        assert len([event for event in replayed_commons['world']['events'] if event['type']=='message-posted'])==1
        assert replayed_commons['world']['revision']==committed_commons['world']['revision']
        assert replayed_commons['world']['xp']==before_commons_xp
        assert replayed_commons['world']['events'][-1]['requestId']==pending_commons['requestId']

        commons_event=next(event for event in replayed_commons['world']['events'] if event['type']=='message-posted' and event['messageId']==commons_message_id)
        commons_event_id=commons_event['id']
        a.locator('#character-button').click()
        expect(a.locator('#sheet-title')).to_have_text('Character & field record')
        expect(a.locator('#sheet')).to_contain_text('Field satchel · retained Commons activity')
        satchel_item=a.locator(f'[data-field-satchel-item="{commons_event_id}"]')
        expect(satchel_item).to_have_count(1)
        expect(satchel_item).to_contain_text(commons_text)
        expect(satchel_item).to_contain_text('retained conversation · not evidence or authority')
        expect(satchel_item).to_contain_text(commons_event_id)
        before_satchel_return=read_state(visitor)
        a.locator(f'[data-field-satchel-return="{commons_event_id}"]').click()
        expect(a.locator('#sheet')).to_be_hidden()
        after_satchel_return=read_state(visitor)
        assert after_satchel_return['world']['revision']==before_satchel_return['world']['revision']
        assert after_satchel_return['world']['events']==before_satchel_return['world']['events']
        assert after_satchel_return['world']['xp']==before_satchel_return['world']['xp']

        b.locator('#character-button').click()
        expect(b.locator('#sheet')).to_contain_text('No retained Commons messages are recorded for this character yet.')
        expect(b.locator('[data-field-satchel-item]')).to_have_count(0)
        close_sheet(b)

        open_commons(b)
        before_mute_state=read_state(visitor)
        b.locator(f'[data-commons-mute="{commons_message_id}"]').click()
        expect(b.locator(f'[data-commons-message-id="{commons_message_id}"]')).to_have_count(0)
        expect(b.locator('#commons-muted-authors')).to_have_count(1)
        b.locator('#commons-muted-authors summary').click()
        founder_identity={
            'id':before_commons['viewer']['id'],
            'role':before_commons['viewer']['role'],
            'name':before_commons['viewer']['name']
        }
        assert founder_identity['role']=='founder' and founder_identity['name']
        expect(b.locator('#commons-muted-authors')).to_contain_text(founder_identity['name'])
        muted_authors=json.loads(b.evaluate("localStorage.getItem('ngl.common-ground.commons-muted-authors.v1')"))
        assert muted_authors==[founder_identity], 'Device-local mute must preserve the exact displayed actor identity'
        after_mute_state=read_state(visitor)
        assert after_mute_state['world']['revision']==before_mute_state['world']['revision']
        assert after_mute_state['world']['events']==before_mute_state['world']['events']
        assert after_mute_state['world']['xp']==before_mute_state['world']['xp']
        founder_mute_view=read_state(owner)
        assert any(event['type']=='message-posted' and event['messageId']==commons_message_id and event['text']==commons_text for event in founder_mute_view['world']['events'])
        b.locator('[data-commons-unmute="damien"]').click()
        expect(b.locator(f'[data-commons-message-id="{commons_message_id}"]')).to_contain_text(commons_text)
        assert json.loads(b.evaluate("localStorage.getItem('ngl.common-ground.commons-muted-authors.v1')"))==[]
        after_unmute_state=read_state(visitor)
        assert after_unmute_state['world']['revision']==before_mute_state['world']['revision']
        assert after_unmute_state['world']['events']==before_mute_state['world']['events']
        assert after_unmute_state['world']['xp']==before_mute_state['world']['xp']
        witness_quest=b.locator('[data-objective-id="witness-commons-message"]')
        expect(witness_quest).to_contain_text('OPEN')
        witness_text='A Witness can add conversation without acquiring Founder authority.'
        b.locator('#commons-message').fill(witness_text)
        b.locator('[data-commons-post="true"]').click()
        expect(b.locator('#toast')).to_contain_text('Message retained')
        expect(witness_quest).to_contain_text('RECORDED')
        witness_card=b.locator(f'[data-commons-message-id="{commons_message_id}"]')
        expect(witness_card).to_contain_text(commons_text)
        witness_card.locator('details summary').click()
        b.locator(f'#commons-report-reason-{commons_message_id}').select_option('privacy')
        b.locator(f'#commons-report-details-{commons_message_id}').fill('A Founder should review the public text, not erase the original.')
        b.locator(f'[data-commons-report="{commons_message_id}"]').click()
        expect(b.locator('#toast')).to_contain_text('Private report retained for Founder review')
        reporter_status=b.locator(f'[data-commons-own-report="{commons_message_id}"]')
        expect(reporter_status).to_have_attribute('data-commons-own-report-status','awaiting-founder-review')
        expect(reporter_status).to_contain_text('AWAITING FOUNDER REVIEW')
        expect(reporter_status).to_contain_text('Status reflects an explicit Founder-session process record, not a factual verdict')
        expect(reporter_status).to_contain_text('A Founder should review the public text')
        report_state=read_state(owner)
        report_event=next(event for event in report_state['world']['events'] if event['type']=='message-reported')
        report_id=report_event['reportId']
        assert len([event for event in report_state['world']['events'] if event['type']=='message-reported'])==1

        open_commons(a)
        founder_card=a.locator(f'[data-commons-message-id="{commons_message_id}"]')
        expect(founder_card.locator('[data-commons-own-report]')).to_have_count(0)
        expect(founder_card.locator(f'[data-commons-hide="{commons_message_id}"]')).to_have_count(1)
        expect(a.locator('#commons-pending-reports')).to_contain_text('A Founder should review the public text')
        pending_report=a.locator(f'[data-commons-pending-report="{report_id}"]')
        expect(pending_report.locator(f'[data-commons-review="{report_id}"]')).to_have_count(1)
        a.locator(f'#commons-moderation-reason-{commons_message_id}').select_option('privacy')
        founder_card.locator(f'[data-commons-hide="{commons_message_id}"]').click()
        expect(a.locator('#toast')).to_contain_text('Message hidden')
        hidden_for_witness=read_state(visitor)
        hidden_post=next(event for event in hidden_for_witness['world']['events'] if event['type']=='message-posted' and event['messageId']==commons_message_id)
        assert hidden_post['text']=='[Message hidden by a Founder moderation action.]'
        assert hidden_for_witness['world']['xp']==before_commons_xp
        founder_hidden=read_state(owner)
        assert next(event for event in founder_hidden['world']['events'] if event['type']=='message-posted' and event['messageId']==commons_message_id)['text']==commons_text
        assert len([event for event in founder_hidden['world']['events'] if event['type']=='message-moderated'])==1
        founder_card=a.locator(f'[data-commons-message-id="{commons_message_id}"]')
        founder_card.locator(f'[data-commons-restore="{commons_message_id}"]').click()
        expect(a.locator('#toast')).to_contain_text('Message restored')
        restored_for_witness=read_state(visitor)
        assert next(event for event in restored_for_witness['world']['events'] if event['type']=='message-posted' and event['messageId']==commons_message_id)['text']==commons_text
        assert len([event for event in restored_for_witness['world']['events'] if event['type']=='message-moderated'])==2
        restored_for_founder=read_state(owner)
        restore_event=[event for event in restored_for_founder['world']['events'] if event['type']=='message-moderated'][-1]
        open_commons(b)
        reporter_status=b.locator(f'[data-commons-own-report="{commons_message_id}"]')
        expect(reporter_status).to_have_attribute('data-commons-own-report-status','awaiting-founder-review')
        expect(reporter_status).to_contain_text('AWAITING FOUNDER REVIEW')
        expect(reporter_status).to_contain_text('Later moderation event '+restore_event['id']+': restore.')
        expect(reporter_status).to_contain_text('not a factual verdict')
        expect(a.locator('#commons-pending-reports')).to_contain_text('A Founder should review the public text')

        review_note='Reviewed as a process step; message visibility remains a separate moderation decision.'
        pending_report=a.locator(f'[data-commons-pending-report="{report_id}"]')
        pending_report.locator('summary').click()
        a.locator(f'#commons-review-note-{report_id}').fill(review_note)
        pending_report.locator(f'[data-commons-review="{report_id}"]').click()
        expect(a.locator('#toast')).to_contain_text('Founder session review recorded')
        reviewed_for_founder=read_state(owner)
        review_events=[event for event in reviewed_for_founder['world']['events'] if event['type']=='message-report-reviewed']
        assert len(review_events)==1
        assert review_events[0]['reportId']==report_id
        assert review_events[0]['messageId']==commons_message_id
        assert review_events[0]['note']==review_note
        assert reviewed_for_founder['world']['revision']==restored_for_founder['world']['revision']+1
        assert reviewed_for_founder['world']['xp']==before_commons_xp
        assert next(event for event in reviewed_for_founder['world']['events'] if event['type']=='message-posted' and event['messageId']==commons_message_id)['text']==commons_text
        open_commons(a)
        expect(a.locator('#commons-pending-reports')).to_have_count(0)

        reviewed_for_witness=read_state(visitor)
        assert any(event['type']=='message-report-reviewed' and event.get('reportId')==report_id and event.get('note')==review_note for event in reviewed_for_witness['world']['events'])
        commons_new_events=[event for event in reviewed_for_founder['world']['events'] if event['id'] not in before_commons_event_ids]
        commons_mutation_types=sorted(event.get('type') for event in commons_new_events if event.get('type')!='discover')
        assert commons_mutation_types==sorted([
            'message-posted','message-posted','message-reported',
            'message-moderated','message-moderated','message-report-reviewed'
        ]), {'unexpectedCommonsEvents':commons_new_events}
        allowed_guide_discoveries={'relay','river','overlook','ruins'}
        allowed_discovery_actor_ids={
            before_commons['viewer']['id'],before_commons_witness['viewer']['id']
        }
        for event in commons_new_events:
            if event.get('type')=='discover':
                assert event.get('locationId') in allowed_guide_discoveries, event
                assert event.get('actor',{}).get('id') in allowed_discovery_actor_ids, event
        assert reviewed_for_founder['world']['revision']==before_commons_revision+len(commons_new_events)
        assert reviewed_for_witness['world']['revision']==reviewed_for_founder['world']['revision']
        assert reviewed_for_founder['world']['xp']==before_commons_xp
        assert reviewed_for_witness['world']['xp']==before_commons_xp
        before_report_status_refresh=read_state(visitor)
        open_commons(b)
        reporter_status=b.locator(f'[data-commons-own-report="{commons_message_id}"]')
        expect(reporter_status).to_have_attribute('data-commons-own-report-status','founder-review-recorded')
        expect(reporter_status).to_contain_text('FOUNDER SESSION REVIEW RECORDED')
        expect(reporter_status).to_contain_text(review_note)
        expect(reporter_status).to_contain_text('Later moderation event '+restore_event['id']+': restore.')
        expect(reporter_status).to_contain_text('not a factual verdict')
        after_report_status_refresh=read_state(visitor)
        assert after_report_status_refresh['world']['revision']==before_report_status_refresh['world']['revision']
        assert after_report_status_refresh['world']['events']==before_report_status_refresh['world']['events']
        assert after_report_status_refresh['world']['xp']==before_report_status_refresh['world']['xp']
        expect(a.locator('[data-objective-id="founder-commons-message"]')).to_contain_text('RECORDED')
        expect(b.locator('[data-objective-id="witness-commons-message"]')).to_contain_text('RECORDED')
        close_sheet(a);a.locator('#character-button').click()
        expect(a.locator('#sheet')).to_contain_text('Speaker')
        expect(a.locator('#sheet')).to_contain_text('1 recorded')
        close_sheet(a);close_sheet(b)

        def open_guild_hall(page):
            close_sheet(page)
            page.locator('#places-button').click()
            walk_to_location(page, 'Guild Hall', enter=False)
            page.bring_to_front()
            clerk_control = page.locator('[data-guild-npc-control="contradiction-clerk"]')
            try:
                page.wait_for_function(
                    "()=>document.querySelector('#sheet')?.hidden===true&&document.querySelector('#play-ui')?.hidden===false",
                    timeout=30000
                )
                expect(clerk_control).to_have_count(1)
                expect(clerk_control).to_be_enabled()
                # This is the NPC-specific keyboard-accessible action, not a
                # synthetic canonical event. Focus reveals the authored control;
                # Enter invokes the same bounded handleNpcAction used by its
                # visible/touch counterpart. Arrival changes only navigation.
                clerk_control.focus()
                expect(clerk_control).to_be_visible()
                if clerk_control.get_attribute('data-guild-npc-action') != 'talk':
                    clerk_control.press('Enter')
                    page.wait_for_function(
                        """() => {
                          const button = document.querySelector('[data-guild-npc-control="contradiction-clerk"]');
                          return button?.dataset.guildNpcAction === 'talk';
                        }""",
                        timeout=30000
                    )
                expect(clerk_control).to_have_attribute('data-guild-npc-action', 'talk')
                expect(clerk_control).to_contain_text('Talk · CLERK')
                # The second explicit activation talks to this exact NPC even
                # when another entity could own the generic nearest-entity HUD.
                clerk_control.press('Enter')
                page.wait_for_function(
                    "()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'&&!document.querySelector('#sheet').hidden",
                    timeout=30000
                )
            except Exception as error:
                page.screenshot(path=str(out/'failed-guild-hall-arrival.png'))
                diagnostics = page.evaluate("""() => {
                    const button = document.querySelector('[data-guild-npc-control="contradiction-clerk"]');
                    const world = document.querySelector('#world');
                    return {
                      nearbyNpcRole: world?.dataset.nearbyNpcRole || null,
                      npcAction: button?.dataset.guildNpcAction || null,
                      npcControlVisible: !!button && !!button.getClientRects().length,
                      npcControlFocused: document.activeElement === button,
                      npcControlLabel: button?.getAttribute('aria-label') || null,
                      nearbyInstitutionId: world?.dataset.nearbyInstitutionId || null,
                      interactLabel: document.querySelector('#interact-button')?.getAttribute('aria-label') || null,
                      sheetTitle: document.querySelector('#sheet-title')?.textContent || null,
                      sheetHidden: document.querySelector('#sheet')?.hidden ?? null,
                      visibilityState: document.visibilityState,
                      hasFocus: document.hasFocus()
                    };
                }""")
                raise AssertionError(
                    'The explicit Contradiction Clerk approach/talk path did not open Guild Hall: ' +
                    json.dumps(diagnostics)
                ) from error
            expect(page.locator('#player-guild-board')).to_be_visible()

        # The fixed local Contradiction Clerk is a world adversary, not a
        # collaborator packet. Exercise approach/talk in the shared server world.
        close_sheet(a)
        a.wait_for_function("()=>!document.body.classList.contains('modal-open')&&document.querySelector('#play-ui')?.hidden===false")
        clerk_before_owner=read_state(owner)
        clerk_before_witness=read_state(visitor)
        assert clerk_before_owner['viewer']['role']=='founder'
        assert clerk_before_witness['viewer']['role']=='witness'
        assert clerk_before_owner['world']['revision']==clerk_before_witness['world']['revision']
        assert clerk_before_owner['world']['xp']==clerk_before_witness['world']['xp']
        clerk_control=a.locator('[data-guild-npc-control="contradiction-clerk"]')
        expect(clerk_control).to_have_count(1)
        expect(clerk_control).to_be_enabled()
        if clerk_control.get_attribute('data-guild-npc-action')!='talk':
            clerk_control.evaluate("(button)=>button.click()")
            a.wait_for_function(
                "()=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl==='contradiction-clerk'&&button.dataset.guildNpcAction==='talk')",
                timeout=60000
            )
        expect(clerk_control).to_have_attribute('data-guild-npc-action','talk')
        clerk_after_approach_owner=read_state(owner)
        clerk_travel_events=assert_navigation_only_discovers(
            clerk_before_owner,clerk_after_approach_owner,'Contradiction Clerk approach'
        )
        allowed_clerk_discoveries={'relay','river','overlook','ruins'}
        assert all(
            event.get('locationId') in allowed_clerk_discoveries and
            event.get('actor',{}).get('id')==clerk_before_owner['viewer']['id']
            for event in clerk_travel_events
        ), clerk_travel_events
        clerk_after_approach_witness=read_state(visitor)
        assert clerk_after_approach_witness['world']['revision']==clerk_after_approach_owner['world']['revision']
        assert clerk_after_approach_witness['world']['xp']==clerk_before_witness['world']['xp']
        clerk_control.evaluate("(button)=>button.click()")
        a.wait_for_function(
            "()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'&&!document.querySelector('#sheet').hidden",
            timeout=30000
        )
        clerk_card=a.locator('[data-local-npc-role="contradiction-clerk"]')
        expect(clerk_card).to_be_visible()
        expect(clerk_card).to_be_focused()
        expect(clerk_card).to_contain_text('BOUNDED ADVERSARY')
        expect(clerk_card).to_contain_text('FIXED LOCAL PROTOCOL')
        expect(clerk_card).to_contain_text('No AI/provider call occurs')
        expect(a.locator('[data-collaborator-role="contradiction-clerk"]')).to_have_count(0)
        clerk_after_talk_owner=read_state(owner)
        clerk_after_talk_witness=read_state(visitor)
        assert clerk_after_talk_owner['world']['revision']==clerk_after_approach_owner['world']['revision']
        assert clerk_after_talk_owner['world']['events']==clerk_after_approach_owner['world']['events']
        assert clerk_after_talk_owner['world']['xp']==clerk_before_owner['world']['xp']
        assert clerk_after_talk_witness['world']['revision']==clerk_after_approach_witness['world']['revision']
        assert clerk_after_talk_witness['world']['events']==clerk_after_approach_witness['world']['events']
        assert clerk_after_talk_witness['world']['xp']==clerk_before_witness['world']['xp']

        # The Witness must physically route to Guild Hall and explicitly talk to
        # the local Clerk before the shared player-guild board is available.
        witness_before_guild_entry=read_state(visitor)
        open_guild_hall(b)
        witness_after_guild_entry=read_state(visitor)
        witness_guild_entry_events=assert_navigation_only_discovers(
            witness_before_guild_entry,witness_after_guild_entry,'Witness Guild Hall navigation and entry'
        )
        allowed_guild_hall_discoveries={'relay','river','overlook','ruins'}
        assert all(
            event.get('locationId') in allowed_guild_hall_discoveries and
            event.get('actor',{}).get('id')==witness_before_guild_entry['viewer']['id']
            for event in witness_guild_entry_events
        ), witness_guild_entry_events

        before_guild=read_state(owner)
        witness_guild_before=read_state(visitor)
        assert before_guild['viewer']['role']=='founder'
        assert witness_guild_before['viewer']['role']=='witness'
        before_guild_revision=before_guild['world']['revision']
        before_guild_xp=before_guild['world']['xp']
        before_guild_event_ids={event['id'] for event in before_guild['world']['events'] if event['type'].startswith('guild-')}
        founder_id=before_guild['viewer']['id']
        witness_id=witness_guild_before['viewer']['id']
        assert before_guild['world']['revision']==witness_guild_before['world']['revision']
        assert witness_id==auto_actor_id, 'the re-entered Witness identity must remain stable through the shared journey'

        expect(a.locator('#player-guild-board')).to_be_visible()
        a.locator('#player-guild-name').fill('Field Researchers')
        a.locator('#player-guild-charter').fill('Compare observations and preserve dissent.')
        a.locator('#player-guild-create').click()
        expect(a.locator('[data-player-guild-id]')).to_have_count(1)
        created_state=read_state(visitor)
        guild_events=[event for event in created_state['world']['events'] if event['type']=='guild-created' and event['id'] not in before_guild_event_ids and event.get('actor',{}).get('id')==founder_id]
        assert len(guild_events)==1, {'newGuildEvents':[(event.get('guildId'),event.get('actor',{}).get('id')) for event in guild_events]}
        guild_id=guild_events[0]['guildId']
        assert guild_events[0]['actor']['id']==founder_id
        assert created_state['world']['revision']==before_guild_revision+1
        assert created_state['world']['xp']==before_guild_xp

        expect(b.locator('#player-guild-board')).to_be_visible()
        member_card=b.locator(f'[data-player-guild-id="{guild_id}"]')
        expect(member_card).to_contain_text('Field Researchers')

        # The Witness inspects the Founder through the actual pixel-world avatar.
        # Guild Hall's nearer Contradiction Clerk may own the generic Interact HUD,
        # so player inspection must target the Founder sprite rather than assume
        # that the nearest-entity HUD button belongs to the player.
        def remote_avatar_target(page, context, role):
            snapshot = read_state(context)
            viewer = snapshot['viewer']
            self_presence_id = viewer.get('presenceId')
            candidates = [
                candidate for candidate in snapshot.get('presence', [])
                if candidate.get('id') != self_presence_id and candidate.get('role') == role
            ]
            assert len(candidates) == 1, {
                'targetRole': role,
                'selfPresenceId': self_presence_id,
                'candidateSessions': [
                    {key: candidate.get(key) for key in ('id', 'actorId', 'role', 'x', 'y')}
                    for candidate in candidates
                ]
            }
            remote = candidates[0]
            local = viewer.get('position')
            assert isinstance(local, dict) and all(math.isfinite(local.get(key, float('nan'))) for key in ('x', 'y')), local
            box = page.locator('#world').bounding_box()
            assert box, 'the pixel-world canvas must be visible before targeting a player avatar'
            width, height = box['width'], box['height']
            # Match WorldView.resize() and cameraTarget(). The renderer eases
            # toward this target; callers wait for the player/camera to settle.
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
            return snapshot, remote, point

        def inspect_remote_avatar(page, context, role):
            # Bring the second session to the foreground before waiting for its
            # camera to settle; background pages pause the world renderer.
            page.bring_to_front()
            page.wait_for_timeout(1200)
            before, remote, point = remote_avatar_target(page, context, role)
            local = before['viewer']['position']
            initial_distance = math.hypot(local['x'] - remote['x'], local['y'] - remote['y'])
            before_revision = before['world']['revision']
            before_xp = before['world']['xp']
            before_event_ids = [event['id'] for event in before['world']['events']]
            page.locator('#world').click(position=point)
            page.wait_for_timeout(250)
            profile = page.locator('[data-player-profile]')
            if profile.is_visible():
                return before, remote, initial_distance, False

            assert initial_distance >= 160, {
                'message': 'A nearby player tap should inspect directly; a distant tap should route.',
                'initialDistance': initial_distance,
                'remote': remote,
                'local': local,
                'point': point
            }
            expect(page.locator('#sheet')).to_be_hidden()

            # A distant avatar tap is navigation only. Wait for the server-
            # observed position to approach the exact session before the second
            # explicit tap; presence is a route target, not a world mutation.
            stable = 0
            previous_position = None
            current = before
            current_remote = remote
            current_distance = initial_distance
            for _ in range(120):
                current, current_remote, _ = remote_avatar_target(page, context, role)
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
                if stable >= 8:
                    break
                page.wait_for_timeout(250)
            assert stable >= 8, {
                'message': 'The avatar route did not reach a stable nearby position.',
                'distance': current_distance,
                'localPosition': current.get('viewer', {}).get('position'),
                'remote': current_remote,
                'nearbyNpcRole': page.locator('#world').get_attribute('data-nearby-npc-role'),
                'nearbyPlayerRole': page.locator('#world').get_attribute('data-nearby-player-role'),
                'interactLabel': page.locator('#interact-button').get_attribute('aria-label')
            }
            assert current['world']['revision'] == before_revision, 'approaching a player must not append a world event'
            assert [event['id'] for event in current['world']['events']] == before_event_ids, 'approaching a player must preserve retained event identity and order'
            assert current['world']['xp'] == before_xp, 'approaching a player must not award XP'

            # Recompute against the settled camera and explicitly tap the same
            # avatar a second time. This is the real player-inspection input path.
            page.wait_for_timeout(1200)
            current, current_remote, point = remote_avatar_target(page, context, role)
            final_distance = math.hypot(
                current['viewer']['position']['x'] - current_remote['x'],
                current['viewer']['position']['y'] - current_remote['y']
            )
            assert final_distance < 160, {
                'message': 'The second avatar tap requires the player to be within interaction range.',
                'distance': final_distance,
                'local': current['viewer']['position'],
                'remote': current_remote
            }
            page.locator('#world').click(position=point)
            expect(profile).to_be_visible(timeout=10000)
            return current, current_remote, initial_distance, True

        # The generic Interact HUD can correctly remain assigned to the closer
        # Contradiction Clerk. Select the Founder avatar itself; if distant, the
        # first tap only routes and the second tap explicitly opens the profile.
        close_sheet(b)
        before_player_inspection, founder_presence, initial_player_distance, routed_to_founder = inspect_remote_avatar(
            b, visitor, 'founder'
        )
        profile=b.locator('[data-player-profile]')
        expect(profile).to_be_visible()
        expect(profile).to_contain_text('Field Researchers')

        # The public player card exposes only a bounded, read-only projection of
        # the inspected actor's retained game progression, never private notes.
        character_card=profile.locator('[data-player-profile-character]')
        expect(character_card).to_be_visible()
        character_summary=character_card.evaluate("""element => {
            const data = element.dataset;
            const values = ['worldRevision','level','xp','sharedPublishedPlaceCount','fieldItemCount',
                'activeSkillCount','visibleSkillCount'].map(key => Number(data[key]));
            return {
                valid: values.every(Number.isSafeInteger) && values.every(value => value >= 0),
                worldRevision: Number(data.worldRevision),
                level: Number(data.level),
                xp: Number(data.xp),
                fieldItemCount: Number(data.fieldItemCount),
                activeSkillCount: Number(data.activeSkillCount),
                visibleSkillCount: Number(data.visibleSkillCount)
            };
        }""")
        assert character_summary['valid'] and character_summary['level'] >= 1, character_summary
        assert character_summary['visibleSkillCount'] <= 6
        assert character_summary['activeSkillCount'] >= character_summary['visibleSkillCount']
        skill_rows=profile.locator('[data-player-profile-skill]')
        assert skill_rows.count()==character_summary['visibleSkillCount']
        skill_counts=[int(row.get_attribute('data-count')) for row in skill_rows.all()]
        assert all(count > 0 for count in skill_counts), skill_counts
        assert skill_counts==sorted(skill_counts,reverse=True), skill_counts

        # Bind the profile to the current public world snapshot and the
        # exact role of the remote avatar selected from the presence snapshot.
        profile_revision=character_summary['worldRevision']
        current_world_revision=int(b.locator('#world').get_attribute('data-world-revision'))
        assert profile_revision==current_world_revision, {
            'profileRevision':profile_revision,'worldRevision':current_world_revision
        }
        assert profile.get_attribute('data-player-role')==founder_presence['role']=='founder'

        assert profile.locator('[data-study-card-collection]').count()==0, (
            'public profile must not expose private study-card content'
        )
        assert profile.locator('[data-field-satchel-item]').count()==0, (
            'public profile must not expose actor-private field satchel content'
        )

        # Exercise the public card at narrow mobile widths. It must remain
        # readable without horizontal page or sheet overflow.
        original_viewport=b.viewport_size
        for width in (320,390):
            b.set_viewport_size({'width':width,'height':800})
            b.wait_for_timeout(120)
            expect(character_card).to_be_visible()
            overflow=b.locator('#sheet-content').evaluate(
                "element => element.scrollWidth > element.clientWidth + 1"
            )
            bounds=character_card.evaluate("""element => {
                const rect = element.getBoundingClientRect();
                return {left:rect.left,right:rect.right};
            }""")
            assert not overflow and bounds['left'] >= 0 and bounds['right'] <= width + 1, {
                'width':width,'overflow':overflow,'bounds':bounds
            }
        b.set_viewport_size(original_viewport)

        inspected_state=read_state(visitor)
        assert inspected_state['world']['revision']==before_player_inspection['world']['revision'], (
            'opening a nearby player card must not append a canonical event'
        )
        assert inspected_state['world']['xp']==before_player_inspection['world']['xp'], (
            'player inspection must not award XP'
        )
        profile.locator(f'[data-player-profile-join-guild="{guild_id}"]').click()
        expect(profile).to_contain_text('You are already a member of this guild.')
        assert profile.locator('[data-player-profile-join-guild]').count()==0, (
            'a member cannot be offered a duplicate self-join action'
        )
        close_sheet(b)
        open_guild_hall(b)
        member_card=b.locator(f'[data-player-guild-id="{guild_id}"]')
        expect(member_card).to_contain_text('GUILD MEMBER')
        expect(member_card).to_contain_text('MEMBERS 2/25')
        leader_card=a.locator(f'[data-player-guild-id="{guild_id}"]')
        expect(leader_card).to_contain_text('GUILD LEADER')
        expect(leader_card).to_contain_text('MEMBERS 2/25')
        assert a.locator(f'[data-player-guild-disband="{guild_id}"]').count()==0
        joined_state=read_state(owner)
        guild_events=[event for event in joined_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['type'] for event in guild_events]==['guild-created','guild-joined']
        assert guild_events[1]['actor']['id']==witness_id
        assert joined_state['world']['revision']==before_guild_revision+2, {
            'before':before_guild_revision,
            'actual':joined_state['world']['revision'],
            'recentEvents':[(event['type'],event.get('actor',{}).get('id')) for event in joined_state['world']['events'][-8:]]
        }
        assert joined_state['world']['xp']==before_guild_xp
        challenged_report=next(event for event in joined_state['world']['events']
            if event['type']=='experiment-reported' and event['reportId']==retained_challenges[0]['reportId'])
        assert challenged_report['actor']['id']==witness_id
        assert retained_challenges[0]['actor']['id']==founder_id
        founder_guild_challenge=a.locator('[data-objective-id="founder-challenge-experiment-report"]')
        expect(founder_guild_challenge).to_contain_text('RECORDED')
        expect(founder_guild_challenge).to_contain_text('Challenge a guild member’s experiment report')
        expect(founder_guild_challenge).to_contain_text(retained_challenges[0]['id'])

        guild_message_event=next(event for event in joined_state['world']['events']
            if event['type']=='message-posted' and event['text']==witness_text)
        assert guild_message_event['actor']['id']==witness_id
        expect(member_card).to_contain_text('GUILD FIELD SATCHEL')
        expect(member_card).to_contain_text(witness_text)
        expect(leader_card).to_contain_text(witness_text)
        guild_message_item=b.locator(f'[data-guild-field-item="{guild_message_event["id"]}"]')
        expect(guild_message_item).to_contain_text(witness_text)
        guild_message_item.locator(f'[data-guild-field-open="{guild_message_event["id"]}"]').click()
        expect(b.locator('#sheet-title')).to_have_text('The Commons at TownSquare')
        open_guild_hall(b)
        member_card=b.locator(f'[data-player-guild-id="{guild_id}"]')
        expect(member_card).to_contain_text('GUILD FIELD SATCHEL')
        expect(member_card).to_contain_text(witness_text)

        early_disband=owner.request.post(url+'api/action',data={
            'type':'disband-guild','guildId':guild_id,'requestId':'browser-guild-early-disband-001'
        })
        assert early_disband.status==409
        assert early_disband.json()['error']['code']=='GUILD_NOT_EMPTY'

        target_value=json.dumps([witness_id,'witness'],separators=(',',':'))
        leader_card.locator(f'[data-player-guild-leadership-target="{guild_id}"]').select_option(value=target_value)
        leader_card.locator(f'[data-player-guild-leadership-offer="{guild_id}"]').click()
        expect(leader_card).to_contain_text('Leadership offer pending')
        expect(member_card).to_contain_text('offered you the in-game guild leader role')
        first_offer_state=read_state(visitor)
        guild_events=[event for event in first_offer_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['type'] for event in guild_events]==[
            'guild-created','guild-joined','guild-leadership-transfer-offered'
        ], {'guildId':guild_id,'events':[(event.get('type'),event.get('guildId'),event.get('actor',{}).get('id')) for event in guild_events]}
        first_offer=guild_events[-1]
        assert first_offer['actor']['id']==founder_id
        assert first_offer['recipientId']==witness_id
        assert first_offer['recipientRole']=='witness'
        assert first_offer_state['world']['revision']==before_guild_revision+3
        assert first_offer_state['world']['xp']==before_guild_xp

        member_card.locator(f'[data-player-guild-leadership-decline="{guild_id}"]').click()
        expect(member_card).to_contain_text('GUILD MEMBER')
        expect(leader_card).to_contain_text('GUILD LEADER')
        # Decline leaves both role labels unchanged. Wait for the retained server
        # event itself rather than letting those unchanged labels race the POST.
        decline_fields={'guildId':guild_id,'offerId':first_offer['offerId']}
        wait_for_page_event(a,'guild-leadership-transfer-declined',decline_fields)
        wait_for_page_event(b,'guild-leadership-transfer-declined',decline_fields)
        declined_state=read_page_state(a)
        declined_witness_state=read_page_state(b)
        guild_events=[event for event in declined_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['type'] for event in guild_events]==[
            'guild-created','guild-joined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-declined'
        ], {'guildId':guild_id,'offerId':first_offer['offerId'],'events':[(event.get('type'),event.get('offerId'),event.get('actor',{}).get('id')) for event in guild_events]}
        witness_guild_events=[event for event in declined_witness_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['id'] for event in witness_guild_events]==[event['id'] for event in guild_events], 'Founder and Witness browser clients must observe the same retained Guild decline sequence'
        assert declined_witness_state['world']['revision']==declined_state['world']['revision']
        assert declined_witness_state['world']['xp']==declined_state['world']['xp']
        assert guild_events[-1]['actor']['id']==witness_id
        assert declined_state['world']['revision']==before_guild_revision+4
        assert declined_state['world']['xp']==before_guild_xp

        leader_card.locator(f'[data-player-guild-leadership-target="{guild_id}"]').select_option(value=target_value)
        leader_card.locator(f'[data-player-guild-leadership-offer="{guild_id}"]').click()
        expect(member_card).to_contain_text('offered you the in-game guild leader role')
        second_offer_state=read_state(owner)
        second_offer=next(event for event in second_offer_state['world']['events']
            if event['type']=='guild-leadership-transfer-offered' and event.get('guildId')==guild_id and event['id']!=first_offer['id'])
        leader_card.locator(f'[data-player-guild-leadership-cancel="{guild_id}"]').click()
        expect(member_card.locator(f'[data-player-guild-leadership-accept="{guild_id}"]')).to_have_count(0)
        cancelled_state=read_state(visitor)
        guild_events=[event for event in cancelled_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['type'] for event in guild_events]==[
            'guild-created','guild-joined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-declined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-cancelled'
        ]
        assert guild_events[-1]['actor']['id']==founder_id
        assert guild_events[-1]['offerId']==second_offer['offerId']
        assert cancelled_state['world']['revision']==before_guild_revision+6
        assert cancelled_state['world']['xp']==before_guild_xp

        leader_card.locator(f'[data-player-guild-leadership-target="{guild_id}"]').select_option(value=target_value)
        leader_card.locator(f'[data-player-guild-leadership-offer="{guild_id}"]').click()
        expect(member_card.locator(f'[data-player-guild-leadership-accept="{guild_id}"]')).to_be_visible()
        member_card.locator(f'[data-player-guild-leadership-accept="{guild_id}"]').click()
        expect(member_card).to_contain_text('GUILD LEADER')
        expect(leader_card).to_contain_text('GUILD MEMBER')
        accepted_state=read_state(owner)
        guild_events=[event for event in accepted_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['type'] for event in guild_events]==[
            'guild-created','guild-joined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-declined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-cancelled','guild-leadership-transfer-offered',
            'guild-leadership-transferred'
        ]
        transfer_event=guild_events[-1]
        assert transfer_event['actor']['id']==witness_id
        assert transfer_event['fromLeaderId']==founder_id
        assert accepted_state['world']['revision']==before_guild_revision+8
        assert accepted_state['world']['xp']==before_guild_xp
        assert not accepted_state['world']['events'][-1].get('institutionalAuthorityGranted',False)

        # The accepted handoff is projected into the recipient's character record,
        # but it remains a game-only activity count with no XP or NGL authority.
        # Close Guild Hall first: its modal backdrop intentionally blocks toolbar
        # input, so the character record must be opened as a separate player action.
        close_sheet(b)
        b.locator('#character-button').click()
        expect(b.locator('#sheet-title')).to_have_text('Character & field record')
        steward_card=b.locator('#sheet-content .field-card').filter(has_text='Guild Steward')
        expect(steward_card).to_contain_text('1 recorded accepted in-game guild leadership handoffs')
        expect(steward_card).to_contain_text('no NGL institutional authority')
        expect(b.locator('#sheet-content')).to_contain_text('0 character XP')
        close_sheet(b)
        open_guild_hall(b)
        member_card=b.locator(f'[data-player-guild-id="{guild_id}"]')
        expect(member_card).to_contain_text('GUILD LEADER')

        # The former leader remains a member until a separate departure event.
        leader_card.locator(f'[data-player-guild-leave="{guild_id}"]').click()
        expect(leader_card).to_contain_text('MEMBERS 1/25')
        expect(member_card).to_contain_text('MEMBERS 1/25')
        left_state=read_state(owner)
        guild_events=[event for event in left_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['type'] for event in guild_events]==[
            'guild-created','guild-joined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-declined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-cancelled','guild-leadership-transfer-offered',
            'guild-leadership-transferred','guild-left'
        ]
        assert guild_events[-1]['actor']['id']==founder_id
        assert left_state['world']['revision']==before_guild_revision+9
        assert left_state['world']['xp']==before_guild_xp
        assert any(event['type']=='message-posted' and event['messageId']==guild_message_event['messageId']
            for event in left_state['world']['events'])
        assert leader_card.locator(f'[data-guild-field-item="{guild_message_event["id"]}"]').count()==0, \
            'a departed member’s work leaves the active roster projection but remains in the Chronicle'
        assert any(event['id']==retained_challenges[0]['id'] for event in left_state['world']['events']), \
            'a challenge against departed work remains in the append-only history'

        member_card.locator(f'[data-player-guild-disband="{guild_id}"]').click()
        expect(b.locator('[data-player-guild-id]')).to_have_count(0)
        expect(b.locator('#player-guild-board')).to_contain_text('No open player guilds are retained yet.')
        final_guild_state=read_state(visitor)
        final_guild_events=[event for event in final_guild_state['world']['events'] if event['type'].startswith('guild-') and event.get('guildId')==guild_id]
        assert [event['type'] for event in final_guild_events]==[
            'guild-created','guild-joined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-declined','guild-leadership-transfer-offered',
            'guild-leadership-transfer-cancelled','guild-leadership-transfer-offered',
            'guild-leadership-transferred','guild-left','guild-disbanded'
        ]
        assert [event['actor']['id'] for event in final_guild_events]==[
            founder_id,witness_id,founder_id,witness_id,founder_id,founder_id,
            founder_id,witness_id,founder_id,witness_id
        ]
        assert final_guild_state['world']['revision']==before_guild_revision+10
        assert final_guild_state['world']['xp']==before_guild_xp
        close_sheet(a);close_sheet(b)

        before={p['id']:p['x'] for p in read_state(owner)['presence']}
        for page in [a,b]:
            # Actual movement exceeds the 1.5-second presence throttle; this is not an interaction readiness delay.
            close_sheet(page);page.locator('#world').focus();page.keyboard.down('ArrowRight');page.wait_for_timeout(2000);page.keyboard.up('ArrowRight')
        a.wait_for_function("async before=>{const r=await(await fetch('/api/state')).json();return r.presence.length===2&&r.presence.every(p=>Object.hasOwn(before,p.id)&&p.x>before[p.id]+1)}",arg=before)
        assert not presence_errors,presence_errors
        a.screenshot(path=str(out/'shared-desktop.png'));b.screenshot(path=str(out/'shared-phone.png'))
        assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')
        # A location or artifact panel may still be open after async shared-state refresh.
        # Dismiss it explicitly before exercising the authenticated logout transition.
        # Exercise the Forge through two independent clients on the same server-authoritative world.
        # The Witness may forge only from their own earlier Relay discovery; the Founder must not
        # equip that item merely because the event is visible in shared history.
        shared_before_forge=read_state(visitor)
        assert shared_before_forge['viewer']['id']==witness_id
        relay_source=next((event for event in shared_before_forge['world']['events']
            if event['type']=='discover' and event.get('locationId')=='relay'
            and event.get('actor',{}).get('id')==witness_id
            and event.get('actor',{}).get('role')=='witness'),None)
        assert relay_source, 'The Witness must retain an actor-attributed Relay discovery before forging.'
        forge_revision=shared_before_forge['world']['revision']
        forge_xp=shared_before_forge['world']['xp']
        close_sheet(b)
        b.locator('#places-button').click()
        walk_to_location(b, "Forge")
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Forge'&&!document.querySelector('#sheet').hidden")
        selector=b.locator('[data-forge-choice="scouting"]')
        source_ids=[option.get_attribute('value') for option in selector.locator('option').all()]
        assert relay_source['id'] in source_ids, 'The shared Forge must expose the Witness’s exact earlier discovery.'
        selector.select_option(relay_source['id'])
        # Capture the mutation response itself, then independently reread the
        # authoritative server state through the context request client. A page
        # fetch/service-worker snapshot must not stand in for committed state.
        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as forge_response_info:
            b.locator('[data-forge-item="scouting"]').click()
        forge_response=forge_response_info.value
        assert forge_response.status==200, "Shared Forge action failed: status={} body={}".format(forge_response.status,forge_response.text())
        forge_body=forge_response.json()
        assert forge_body['viewer']['id']==witness_id and forge_body['viewer']['role']=='witness'
        response_forge_events=[event for event in forge_body['world']['events'] if event.get('type')=='field-item-forged']
        response_forged_event=next((event for event in response_forge_events if event.get('sourceEventId')==relay_source['id']),None)
        assert response_forged_event, "Forge response omitted the Witness source link: revision={} forgeEvents={}".format(forge_body['world']['revision'],[(event.get('sourceEventId'),event.get('actor')) for event in response_forge_events])
        forged_state=read_state(visitor)
        assert forged_state['viewer']['id']==witness_id and forged_state['viewer']['role']=='witness'
        forge_events=[event for event in forged_state['world']['events'] if event.get('type')=='field-item-forged']
        forged_event=next((event for event in forge_events if event.get('id')==response_forged_event['id']),None)
        assert forged_event, "Committed shared state did not retain response event {}: revision={} forgeEvents={}".format(response_forged_event['id'],forged_state['world']['revision'],[(event.get('sourceEventId'),event.get('actor')) for event in forge_events])
        assert forged_event['sourceEventId']==relay_source['id']
        assert forged_event['actor']['id']==witness_id and forged_event['actor']['role']=='witness'
        assert forged_state['world']['revision']==forge_revision+1
        assert forged_state['world']['xp']==forge_xp
        founder_state=read_state(owner)
        founder_id=founder_state['viewer']['id']
        assert founder_state['viewer']['role']=='founder'
        assert any(event['id']==forged_event['id'] for event in founder_state['world']['events']), \
            'The shared Chronicle must retain the Witness item event for the Founder to inspect.'
        assert founder_state['world']['revision']==forge_revision+1

        # A Founder request that names the Witness item must fail without an event or revision.
        rejected=a.evaluate("""async (sourceEventId)=>{const response=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'equip-field-item',slotId:'scouting',sourceEventId,requestId:'browser-forge-foreign-equip-001'})});return {status:response.status,body:await response.json()}}""",forged_event['id'])
        assert rejected['status']==409, f'Founder must not equip a Witness-owned item: {rejected}'
        after_rejection=a.evaluate("async()=>await(await fetch('/api/state')).json()")
        assert after_rejection['world']['revision']==forge_revision+1
        assert not any(event['type']=='field-item-equipped' and event.get('sourceEventId')==forged_event['id']
            for event in after_rejection['world']['events'])

        # The Forge must own the playable field-kit loop; Character Record remains a
        # secondary status view. Exercise the in-world controls at a narrow phone width.
        original_forge_viewport=b.viewport_size
        b.set_viewport_size({'width':320,'height':780})
        assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')
        forge_kit=b.locator('[data-field-kit-root="true"]')
        expect(forge_kit).to_be_visible()
        witness_item=forge_kit.locator(f'[data-field-item-id="{forged_event["itemId"]}"]')
        expect(witness_item).to_be_visible()
        expect(forge_kit.locator('[data-equipment-slot="scouting"]')).to_contain_text('Empty equipment slot')
        assert read_state(visitor)['world']['revision']==forge_revision+1, 'Inspecting the Forge field kit must be read-only.'

        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as equip_response_info:
            witness_item.locator(f'[data-equip-forged-item="{forged_event["itemId"]}"]').click()
        equip_response=equip_response_info.value
        assert equip_response.status==200, "Forge equip action failed: status={} body={}".format(equip_response.status,equip_response.text())
        equip_body=equip_response.json()
        assert equip_body['viewer']['id']==witness_id and equip_body['viewer']['role']=='witness'
        response_equipped_event=next((event for event in equip_body['world']['events']
            if event.get('type')=='field-item-equipped' and event.get('sourceEventId')==forged_event['id']),None)
        assert response_equipped_event, "Forge equip response omitted the Witness equipment event for item {}".format(forged_event['id'])
        equipped_state=read_state(visitor)
        equipped_event=next((event for event in equipped_state['world']['events']
            if event.get('id')==response_equipped_event['id']),None)
        assert equipped_event, "Committed shared state did not retain equipment event {}".format(response_equipped_event['id'])
        assert equipped_event['sourceEventId']==forged_event['id']
        assert equipped_event['actor']['id']==witness_id and equipped_event['actor']['role']=='witness'
        assert equipped_state['world']['revision']==forge_revision+2
        assert equipped_state['world']['xp']==forge_xp
        expect(forge_kit.locator('[data-equipment-slot="scouting"]')).to_contain_text('Equipped')

        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as unequip_response_info:
            forge_kit.locator('[data-unequip-field-item="scouting"]').click()
        unequip_response=unequip_response_info.value
        assert unequip_response.status==200, "Forge unequip action failed: status={} body={}".format(unequip_response.status,unequip_response.text())
        unequip_body=unequip_response.json()
        response_unequipped_event=next((event for event in unequip_body['world']['events']
            if event.get('type')=='field-item-unequipped' and event.get('slotId')=='scouting'),None)
        assert response_unequipped_event, 'Forge unequip response omitted the retained slot transition.'
        unequipped_state=read_state(visitor)
        unequipped_event=next((event for event in unequipped_state['world']['events']
            if event.get('id')==response_unequipped_event['id']),None)
        assert unequipped_event and unequipped_event['actor']['id']==witness_id and unequipped_event['actor']['role']=='witness'
        assert unequipped_state['world']['revision']==forge_revision+3
        assert unequipped_state['world']['xp']==forge_xp
        expect(forge_kit.locator('[data-equipment-slot="scouting"]')).to_contain_text('Empty equipment slot')

        # Re-equip after a retained unequip; the same actor-owned item remains usable.
        forge_item=forge_kit.locator(f'[data-field-item-id="{forged_event["itemId"]}"]')
        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as re_equip_response_info:
            forge_item.locator(f'[data-equip-forged-item="{forged_event["itemId"]}"]').click()
        re_equip_response=re_equip_response_info.value
        assert re_equip_response.status==200, "Forge re-equip action failed: status={} body={}".format(re_equip_response.status,re_equip_response.text())
        re_equip_body=re_equip_response.json()
        response_re_equipped_event=next((event for event in reversed(re_equip_body['world']['events'])
            if event.get('type')=='field-item-equipped' and event.get('sourceEventId')==forged_event['id']),None)
        assert len([event for event in re_equip_body['world']['events']
            if event.get('type')=='field-item-equipped' and event.get('sourceEventId')==forged_event['id']])==2
        assert response_re_equipped_event, 'Forge re-equip response omitted the retained equipment event.'
        re_equipped_state=read_state(visitor)
        re_equipped_event=next((event for event in re_equipped_state['world']['events']
            if event.get('id')==response_re_equipped_event['id']),None)
        assert re_equipped_event and re_equipped_event['actor']['id']==witness_id and re_equipped_event['actor']['role']=='witness'
        assert re_equipped_state['world']['revision']==forge_revision+4
        assert re_equipped_state['world']['xp']==forge_xp
        expect(forge_kit.locator('[data-equipment-slot="scouting"]')).to_contain_text('Equipped')
        expect(forge_kit).to_contain_text('1 equipped slot · Armor-Bearer field kit')
        assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')

        close_sheet(b)
        b.locator('#character-button').click()
        expect(b.locator(f'[data-field-item-id="{forged_event["itemId"]}"]')).to_be_visible()
        expect(b.locator('[data-equipment-slot="scouting"]')).to_contain_text('Equipped')
        b.set_viewport_size(original_forge_viewport)

        # Re-enter both sessions. The event is shared, but the inventory/loadout projection is actor-scoped.
        a.reload(wait_until='domcontentloaded')
        a.locator('#start-shared').click()
        a.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Founder')")
        assert a.evaluate("async()=> (await(await fetch('/api/state')).json()).viewer.id")==founder_id
        a.locator('#character-button').click()
        assert a.locator(f'[data-field-item-id="{forged_event["itemId"]}"]').count()==0
        expect(a.locator('[data-equipment-slot="scouting"]')).to_contain_text('Empty equipment slot')

        b.reload(wait_until='domcontentloaded')
        b.locator('#start-shared').click()
        b.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        assert b.evaluate("async()=> (await(await fetch('/api/state')).json()).viewer.id")==witness_id
        b.locator('#character-button').click()
        expect(b.locator(f'[data-field-item-id="{forged_event["itemId"]}"]')).to_be_visible()
        expect(b.locator('[data-equipment-slot="scouting"]')).to_contain_text('Equipped')

        # Complete a real two-session transfer from the Forge UI at 320px.
        # The original creator/source remain immutable; only an accepted event
        # changes the current-owner projection. Actor IDs are pseudonymous.
        transfer_start=read_state(visitor)
        transfer_start_revision=transfer_start['world']['revision']
        transfer_start_xp=transfer_start['world']['xp']
        b.set_viewport_size({'width':320,'height':780})
        transfer_kit=b.locator('[data-field-kit-root="true"]')
        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as transfer_unequip_info:
            transfer_kit.locator('[data-unequip-field-item="scouting"]').click()
        transfer_unequip=transfer_unequip_info.value
        assert transfer_unequip.status==200, "Transfer preparation unequip failed: status={} body={}".format(transfer_unequip.status,transfer_unequip.text())
        transfer_unequip_body=transfer_unequip.json()
        assert transfer_unequip_body['world']['xp']==transfer_start_xp
        b.wait_for_function(
            """args=>{const select=document.querySelector('[data-transfer-recipient="'+args.itemId+'"]');return !!select&&Array.from(select.options).some(option=>option.value===args.founderId)}""",
            arg={'itemId':forged_event['itemId'],'founderId':founder_id}
        )
        transfer_selector=transfer_kit.locator(f'[data-transfer-recipient="{forged_event["itemId"]}"]')
        expect(transfer_selector).to_be_visible()
        transfer_selector.locator(f'option[value="{founder_id}"]').wait_for(state="attached")
        transfer_selector.select_option(founder_id)
        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as transfer_offer_info:
            transfer_kit.locator(f'[data-offer-field-item="{forged_event["itemId"]}"]').click()
        transfer_offer_response=transfer_offer_info.value
        assert transfer_offer_response.status==200, "Transfer offer failed: status={} body={}".format(transfer_offer_response.status,transfer_offer_response.text())
        transfer_offer_body=transfer_offer_response.json()
        transfer_offer_event=transfer_offer_body['world']['events'][-1]
        assert transfer_offer_event['type']=='field-item-transfer-offered'
        assert transfer_offer_event['actor']['id']==witness_id
        assert transfer_offer_event['recipientId']==founder_id
        assert transfer_offer_body['world']['xp']==transfer_start_xp
        cancel_button=transfer_kit.locator(f'[data-cancel-field-item-transfer="{transfer_offer_event["offerId"]}"]')
        expect(cancel_button).to_be_visible()
        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as transfer_cancel_info:
            cancel_button.click()
        transfer_cancel_response=transfer_cancel_info.value
        assert transfer_cancel_response.status==200, "Transfer cancellation failed: status={} body={}".format(transfer_cancel_response.status,transfer_cancel_response.text())
        transfer_cancel_body=transfer_cancel_response.json()
        assert transfer_cancel_body['world']['events'][-1]['type']=='field-item-transfer-cancelled'
        assert transfer_cancel_body['world']['xp']==transfer_start_xp

        # Re-offer after cancellation. The Founder receives the live offer in
        # the open Character Record and is the only actor allowed to accept it.
        transfer_selector=transfer_kit.locator(f'[data-transfer-recipient="{forged_event["itemId"]}"]')
        transfer_selector.select_option(founder_id)
        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as transfer_offer_again_info:
            transfer_kit.locator(f'[data-offer-field-item="{forged_event["itemId"]}"]').click()
        transfer_offer_again=transfer_offer_again_info.value
        assert transfer_offer_again.status==200
        transfer_offer_again_body=transfer_offer_again.json()
        accepted_offer=transfer_offer_again_body['world']['events'][-1]
        assert accepted_offer['type']=='field-item-transfer-offered'
        incoming_section=a.locator('[data-incoming-field-transfers="true"]')
        expect(incoming_section).to_be_visible()
        with a.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as transfer_accept_info:
            incoming_section.locator(f'[data-accept-field-item-transfer="{accepted_offer["offerId"]}"]').click()
        transfer_accept_response=transfer_accept_info.value
        assert transfer_accept_response.status==200, "Recipient acceptance failed: status={} body={}".format(transfer_accept_response.status,transfer_accept_response.text())
        transfer_accept_body=transfer_accept_response.json()
        transfer_event=transfer_accept_body['world']['events'][-1]
        assert transfer_event['type']=='field-item-transferred'
        assert transfer_event['actor']['id']==founder_id and transfer_event['actor']['role']=='founder'
        assert transfer_event['fromActorId']==witness_id and transfer_event['fromActorRole']=='witness'
        assert transfer_event['itemEventId']==forged_event['id']
        assert transfer_event['itemId']==forged_event['itemId']
        assert transfer_accept_body['world']['revision']==transfer_start_revision+5
        assert transfer_accept_body['world']['xp']==transfer_start_xp
        transferred_founder_state=read_state(owner)
        transferred_witness_state=read_state(visitor)
        assert transferred_founder_state['world']['revision']==transfer_start_revision+5
        assert transferred_witness_state['world']['revision']==transfer_start_revision+5
        assert transferred_founder_state['world']['xp']==transfer_start_xp
        assert transferred_witness_state['world']['xp']==transfer_start_xp
        expect(a.locator(f'[data-field-item-id="{forged_event["itemId"]}"]')).to_be_visible()
        expect(a.locator(f'[data-field-item-id="{forged_event["itemId"]}"]')).to_contain_text('current owner '+founder_id)
        expect(a.locator(f'[data-field-item-id="{forged_event["itemId"]}"]')).to_contain_text('Original creator '+witness_id)
        assert b.locator(f'[data-field-item-id="{forged_event["itemId"]}"]').count()==0

        # A local notebook note is only a proposal until the current player explicitly submits it.
        visit(b,'The shared observatory')
        b.locator('#enter-creation').click()
        handoff_frame=b.frame_locator('#artifact-frame')
        expect(handoff_frame.locator('html')).to_have_attribute('data-ngl-ready','true')
        handoff_claim='Handoff fixture: a model says the bridge is open.'
        handoff_source='Model output only; no external source was retrieved.'
        handoff_falsifier='A direct observation shows the bridge is closed.'
        handoff_uncertainty='No independent observation has been made.'
        handoff_next_test='Inspect the retained primary source directly.'
        for selector,value in [
            ('#claim',handoff_claim),('#source',handoff_source),('#falsifier',handoff_falsifier),
            ('#uncertainty',handoff_uncertainty),('#next-test',handoff_next_test)
        ]:
            handoff_frame.locator(selector).fill(value)
        handoff_frame.locator('#source-kind').select_option('model-assertion')
        handoff_frame.locator('#add-observation').click()
        # Export the actual local notebook, close it, and restore that exact file into
        # a fresh published Observatory instance before the explicit Chronicle handoff.
        with b.expect_download() as handoff_download:
            handoff_frame.locator('#download').click()
        handoff_backup_path=handoff_download.value.path()
        handoff_backup=json.loads(Path(handoff_backup_path).read_text())
        assert handoff_backup['schema']=='ngl.source-observatory.v2'
        assert handoff_backup['assurance']=={
            'sourceRetrieval':'NOT_PERFORMED',
            'independentVerification':'NOT_PERFORMED',
            'modelAssertions':'LEADS_ONLY',
            'execution':'NOT_EXECUTED'
        }
        assert handoff_backup['observations'][0]['claim']==handoff_claim
        b.locator('#portal-close').click()
        close_sheet(b)
        visit(b,'The shared observatory')
        b.locator('#enter-creation').click()
        handoff_frame=b.frame_locator('#artifact-frame')
        expect(handoff_frame.locator('html')).to_have_attribute('data-ngl-ready','true')
        expect(handoff_frame.locator('#observations article')).to_have_count(0)
        handoff_before_preview=read_page_state(b)
        handoff_frame.locator('#backup-file').set_input_files(handoff_backup_path)
        handoff_frame.locator('#preview-restore').click()
        expect(handoff_frame.locator('#status')).to_contain_text('Preview ready: 1 new note(s)')
        expect(handoff_frame.locator('#restore')).to_be_enabled()
        handoff_after_preview=read_page_state(b)
        assert handoff_after_preview['world']['revision']==handoff_before_preview['world']['revision']
        assert handoff_after_preview['world']['xp']==handoff_before_preview['world']['xp']
        handoff_frame.locator('#restore').click()
        expect(handoff_frame.locator('#observations article')).to_have_count(1)
        expect(handoff_frame.locator('#observations')).to_contain_text('Restored from a user-selected backup')
        expect(handoff_frame.locator('#status')).to_contain_text('Added 1 local observation(s)')
        handoff_after_restore=read_page_state(b)
        assert handoff_after_restore['world']['revision']==handoff_before_preview['world']['revision']
        assert handoff_after_restore['world']['xp']==handoff_before_preview['world']['xp']
        prepare_handoff=handoff_frame.locator('[data-source-observation-prepare="true"]')
        expect(prepare_handoff).to_be_visible()
        handoff_before=handoff_after_restore
        handoff_actor=handoff_before['viewer']
        handoff_creation=next(item for item in handoff_before['world']['creations'] if item['title']=='The shared observatory')
        handoff_creation_id=handoff_creation['id']
        handoff_version=handoff_creation['version']
        assert handoff_actor['role']=='witness' and handoff_version==2
        # Same opaque origin is not sufficient: the host must receive the message from the selected artifact window.
        b.evaluate("""backup => {
            const current=document.getElementById('artifact-frame');
            const rogue=document.createElement('iframe');
            rogue.setAttribute('sandbox','allow-scripts');
            document.body.append(rogue);
            const message={type:'ngl-source-observation-prepare',backup};
            window.dispatchEvent(new MessageEvent('message',{data:message,origin:'null',source:rogue.contentWindow}));
            window.dispatchEvent(new MessageEvent('message',{data:message,origin:'https://untrusted.example',source:current.contentWindow}));
            rogue.remove();
        }""",handoff_backup)
        assert b.locator('[data-source-observation-form]').count()==0
        expect(b.locator('#portal')).to_be_visible()
        handoff_after_untrusted=read_page_state(b)
        assert handoff_after_untrusted['world']['revision']==handoff_before['world']['revision']
        assert [event['id'] for event in handoff_after_untrusted['world']['events']]==[event['id'] for event in handoff_before['world']['events']]
        assert handoff_after_untrusted['world']['xp']==handoff_before['world']['xp']
        prepare_handoff.click()
        expect(b.locator('#portal')).to_be_hidden()
        expect(b.locator('[data-source-observation-form]')).to_be_visible()
        disclosure=b.locator('[data-source-observation-local-note-disclosure]')
        expect(disclosure).to_contain_text('sandboxed local Source Observatory notebook')
        expect(disclosure).to_contain_text('does not establish original authorship')
        assert 'backup' not in disclosure.inner_text().lower(), 'the host cannot assert a backup origin for a note entered in the open artifact'
        assert b.locator('#source-observation-claim').input_value()==handoff_claim
        assert b.locator('#source-observation-kind').input_value()=='model-assertion'
        assert b.locator('#source-observation-source').input_value()==handoff_source
        pre_submit=read_page_state(b)
        assert pre_submit['world']['revision']==handoff_before['world']['revision']
        assert [event['id'] for event in pre_submit['world']['events']]==[event['id'] for event in handoff_before['world']['events']]
        assert pre_submit['world']['xp']==handoff_before['world']['xp']
        handoff_fields={
            'claim':handoff_claim,'creationId':handoff_creation_id,'version':handoff_version,
            'actorId':handoff_actor['id'],'actorRole':'witness'
        }
        b.locator('#source-observation-submit').click()
        wait_for_page_event(a,'source-observation-recorded',handoff_fields)
        wait_for_page_event(b,'source-observation-recorded',handoff_fields)
        after_submit_a=read_page_state_until_event(a,'source-observation-recorded',handoff_fields)
        after_submit_b=read_page_state_until_event(b,'source-observation-recorded',handoff_fields)
        handoff_matches=lambda event: (
            event['type']=='source-observation-recorded' and event.get('claim')==handoff_claim and
            event.get('actor',{}).get('id')==handoff_actor['id'] and
            event.get('actor',{}).get('role')==handoff_actor['role'] and
            event.get('creationId')==handoff_creation_id and event.get('version')==handoff_version
        )
        handoff_events=[event for event in after_submit_b['world']['events'] if handoff_matches(event)]
        handoff_events_a=[event for event in after_submit_a['world']['events'] if handoff_matches(event)]
        def summarize_handoff_snapshot(label,state):
            world=state.get('world') or {}
            viewer=state.get('viewer') or {}
            events=world.get('events') or []
            matches=[event for event in events if handoff_matches(event)]
            return {
                'source':label,'viewerId':viewer.get('id'),'viewerRole':viewer.get('role'),
                'worldId':world.get('id'),'revision':world.get('revision'),
                'eventCount':len(events),'matchingEventIds':[event.get('id') for event in matches]
            }
        def read_handoff_snapshot(label,reader):
            try:
                return summarize_handoff_snapshot(label,reader())
            except Exception as error:
                return {'source':label,'error':str(error)}
        def capture_handoff_snapshots():
            return [
                read_handoff_snapshot('founder-page',lambda:read_page_state(a)),
                read_handoff_snapshot('witness-page',lambda:read_page_state(b)),
                read_handoff_snapshot('founder-request-context',lambda:read_state(owner)),
                read_handoff_snapshot('witness-request-context',lambda:read_state(visitor))
            ]
        handoff_diagnostics=None
        if len(handoff_events)!=1 or len(handoff_events_a)!=1:
            handoff_diagnostics={
                'immediate':[
                    summarize_handoff_snapshot('founder-page',after_submit_a),
                    summarize_handoff_snapshot('witness-page',after_submit_b),
                    read_handoff_snapshot('founder-request-context',lambda:read_state(owner)),
                    read_handoff_snapshot('witness-request-context',lambda:read_state(visitor))
                ]
            }
            a.wait_for_timeout(250)
            handoff_diagnostics['after250ms']=capture_handoff_snapshots()
        assert len(handoff_events)==len(handoff_events_a)==1, {
            'expectedActor':handoff_actor,'creationId':handoff_creation_id,'version':handoff_version,
            'witnessMatches':handoff_events,'founderMatches':handoff_events_a,
            'diagnostics':handoff_diagnostics
        }
        handoff_event=handoff_events[0]
        assert handoff_events_a[0]['id']==handoff_event['id']
        assert handoff_event['actor']['id']==handoff_actor['id'] and handoff_event['actor']['role']=='witness'
        assert handoff_event['creationId']==handoff_creation_id and handoff_event['version']==handoff_version
        assert handoff_event['originSchema']=='ngl.source-observatory.v2' and handoff_event['bindingMode']=='USER_SELECTED'
        assert handoff_event['sourceKind']=='model-assertion' and handoff_event['source']==handoff_source
        assert handoff_event['falsifier']==handoff_falsifier and handoff_event['uncertainty']==handoff_uncertainty
        assert handoff_event['nextTest']==handoff_next_test
        assert handoff_event['sourceRetrieval']=='NOT_PERFORMED'
        assert handoff_event['independentVerification']=='NOT_PERFORMED'
        assert handoff_event['modelAssertions']=='LEADS_ONLY'
        assert handoff_event['execution']=='NOT_EXECUTED'
        assert handoff_event['requestId']==handoff_event['observationId']
        assert re.fullmatch(r'source-observation-[0-9a-f]{64}',handoff_event['observationId'])
        assert handoff_event['normalizedRecordDigest']==handoff_event['observationId'].removeprefix('source-observation-')
        assert after_submit_a['world']['revision']==after_submit_b['world']['revision']==pre_submit['world']['revision']+1
        assert after_submit_a['world']['xp']==after_submit_b['world']['xp']==pre_submit['world']['xp']
        assert len(after_submit_b['world']['events'])==len(pre_submit['world']['events'])+1
        expect(b.locator('#toast')).to_contain_text('Source observation retained in the shared world')
        assert not errors,errors

        # Re-entering the same actor/version/note must surface the server replay receipt, not look like a new event.
        visit(b,'The shared observatory')
        b.locator('#enter-creation').click()
        handoff_frame=b.frame_locator('#artifact-frame')
        expect(handoff_frame.locator('html')).to_have_attribute('data-ngl-ready','true')
        expect(handoff_frame.locator('#observations article')).to_have_count(0)
        handoff_frame.locator('#backup-file').set_input_files(handoff_backup_path)
        handoff_frame.locator('#preview-restore').click()
        expect(handoff_frame.locator('#status')).to_contain_text('Preview ready: 1 new note(s)')
        handoff_frame.locator('#restore').click()
        expect(handoff_frame.locator('#observations article')).to_have_count(1)
        expect(handoff_frame.locator('#observations')).to_contain_text('Restored from a user-selected backup')
        prepare_handoff=handoff_frame.locator('[data-source-observation-prepare="true"]')
        expect(prepare_handoff).to_be_visible()
        prepare_handoff.click()
        expect(b.locator('[data-source-observation-form]')).to_be_visible()
        shared_attribution_disclosure=b.locator('[data-source-observation-attribution-disclosure="shared"]')
        expect(shared_attribution_disclosure).to_be_visible()
        expect(shared_attribution_disclosure).to_contain_text('authenticated session')
        expect(shared_attribution_disclosure).to_contain_text('does not prove a distinct human')
        replay_before=read_page_state(b)
        b.locator('#source-observation-submit').click()
        expect(b.locator('#toast')).to_contain_text('already retained')
        replay_after_b=read_page_state(b)
        replay_after_a=read_page_state(a)
        assert replay_after_b['world']['revision']==replay_before['world']['revision']
        assert [event['id'] for event in replay_after_b['world']['events']]==[event['id'] for event in replay_before['world']['events']]
        assert replay_after_b['world']['xp']==replay_before['world']['xp']
        replay_events=[event for event in replay_after_b['world']['events'] if handoff_matches(event)]
        assert len(replay_events)==1 and replay_events[0]['observationId']==handoff_event['observationId']
        assert replay_after_a['world']['revision']==replay_after_b['world']['revision']
        assert replay_after_a['world']['xp']==replay_after_b['world']['xp']
        handoff_recovery={
            'observationId':handoff_event['observationId'],'eventId':handoff_event['id'],
            'creationId':handoff_creation_id,'version':handoff_version,
            'actorId':handoff_actor['id'],'actorRole':handoff_actor['role']
        }

        # The Forge exposes the complete actor-scoped source history through bounded,
        # read-only pages. Create 101 real Witness contribution actions on the shared server;
        # the first is older than the newest 100 and must remain forgeable on page two.
        pagination_start=read_state(visitor)
        assert pagination_start['viewer']['id']==witness_id and pagination_start['viewer']['role']=='witness'
        pagination_creation=next((creation for creation in pagination_start['world']['creations']
            if creation.get('id')==handoff_creation_id),None)
        assert pagination_creation and any(version.get('version')==handoff_version for version in [*pagination_creation.get('versions',[]),pagination_creation])
        pagination_revision_before=pagination_start['world']['revision']
        pagination_xp_before=pagination_start['world']['xp']
        first_pagination_event_id=None
        pagination_event_ids=[]
        pagination_texts=[f'Forge pagination contribution {index:03d}' for index in range(101)]
        for index,text_value in enumerate(pagination_texts):
            response=visitor.request.post(url+'api/action',data={
                'type':'contribute','creationId':handoff_creation_id,'version':handoff_version,'text':text_value
            })
            assert response.status==200, 'Witness contribution {} failed: {}'.format(index,response.text())
            retained_event=response.json()['world']['events'][-1]
            assert retained_event['type']=='contribute'
            assert retained_event['actor']['id']==witness_id and retained_event['actor']['role']=='witness'
            pagination_event_ids.append(retained_event['id'])
            if index==0:
                first_pagination_event_id=retained_event['id']
        assert first_pagination_event_id
        pagination_after_writes=read_state(visitor)
        new_pagination_records=[record for record in pagination_after_writes['world']['contributions']
            if record.get('text') in pagination_texts and record.get('actor',{}).get('id')==witness_id
            and record.get('actor',{}).get('role')=='witness']
        assert len(new_pagination_records)==101
        assert pagination_after_writes['world']['revision']==pagination_revision_before+101
        assert pagination_after_writes['world']['xp']==pagination_xp_before
        assert all(event_id in {event['id'] for event in pagination_after_writes['world']['events']}
            for event_id in pagination_event_ids)

        # The Founder sees the shared Chronicle events but never receives the Witness's
        # contribution batch as eligible sources in the Founder's own Forge projection.
        owner_forge_state=read_state(owner)
        assert owner_forge_state['viewer']['id']==founder_id and owner_forge_state['viewer']['role']=='founder'
        assert all(event_id in {event['id'] for event in owner_forge_state['world']['events']}
            for event_id in pagination_event_ids)
        a.reload(wait_until='domcontentloaded')
        a.locator('#start-shared').click()
        a.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Founder')")
        assert read_state(owner)['viewer']['id']==founder_id
        a.locator('#places-button').click()
        walk_to_location(a,'Forge')
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Forge'&&!document.querySelector('#sheet').hidden")
        owner_source_values=a.locator('[data-forge-choice]').evaluate_all(
            "selectors=>selectors.flatMap(selector=>Array.from(selector.options).map(option=>option.value))"
        )
        assert all(event_id not in owner_source_values for event_id in pagination_event_ids), (
            'the Founder Forge must not expose the Witness contribution batch'
        )
        # Reload the same Witness actor to consume the latest server snapshot, then browse at 320px.
        b.reload(wait_until='domcontentloaded')
        b.locator('#start-shared').click()
        b.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        assert read_state(visitor)['viewer']['id']==witness_id
        b.set_viewport_size({'width':320,'height':780})
        b.locator('#places-button').click()
        walk_to_location(b,'Forge')
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Forge'&&!document.querySelector('#sheet').hidden")
        observation_card=b.locator('[data-forge-slot="observation"]')
        expect(observation_card).to_be_visible()
        expect(observation_card).to_have_attribute('data-forge-source-page','0')
        assert int(observation_card.get_attribute('data-forge-source-total'))>=101
        observation_selector=b.locator('[data-forge-choice="observation"]')
        expect(observation_selector).to_have_count(1)
        newest_page_ids=[option.get_attribute('value') for option in observation_selector.locator('option').all()]
        assert len(newest_page_ids)==100
        assert first_pagination_event_id not in newest_page_ids
        pagination_before_navigation=read_state(visitor)
        pagination_event_ids_before=[event['id'] for event in pagination_before_navigation['world']['events']]
        older_button=observation_card.locator('[data-forge-source-older="observation"]')
        older_bounds=older_button.bounding_box()
        assert older_bounds and older_bounds['x']>=-1 and older_bounds['x']+older_bounds['width']<=320+1 and older_bounds['height']>=44, older_bounds
        older_button.click()
        b.wait_for_function("()=>document.querySelector('[data-forge-slot=observation]')?.getAttribute('data-forge-source-page')==='1'")
        older_card=b.locator('[data-forge-slot="observation"]')
        expect(older_card.locator('[data-forge-source-page-status="observation"]')).to_contain_text('Page 2 of')
        older_selector=b.locator('[data-forge-choice="observation"]')
        older_page_ids=[option.get_attribute('value') for option in older_selector.locator('option').all()]
        assert first_pagination_event_id in older_page_ids
        pagination_after_navigation=read_state(visitor)
        assert pagination_after_navigation['world']['revision']==pagination_before_navigation['world']['revision']
        assert pagination_after_navigation['world']['xp']==pagination_before_navigation['world']['xp']
        assert [event['id'] for event in pagination_after_navigation['world']['events']]==pagination_event_ids_before, (
            'page navigation must not append, remove, or reorder canonical events'
        )
        newer_button=older_card.locator('[data-forge-source-newer="observation"]')
        expect(newer_button).to_be_visible()
        newer_button.click()
        b.wait_for_function("()=>document.querySelector('[data-forge-slot=observation]')?.getAttribute('data-forge-source-page')==='0'")
        assert first_pagination_event_id not in [
            option.get_attribute('value') for option in b.locator('[data-forge-choice="observation"] option').all()
        ]
        b.locator('[data-forge-source-older="observation"]').click()
        b.wait_for_function("()=>document.querySelector('[data-forge-slot=observation]')?.getAttribute('data-forge-source-page')==='1'")
        b.locator('[data-forge-choice="observation"]').select_option(first_pagination_event_id)
        with b.expect_response(lambda response: response.url.endswith('/api/action') and response.request.method=='POST') as older_forge_info:
            b.locator('[data-forge-item="observation"]').click()
        older_forge_response=older_forge_info.value
        assert older_forge_response.status==200, 'Forging an older paged source failed: '+older_forge_response.text()
        older_forge_body=older_forge_response.json()
        older_forge_event=next((event for event in reversed(older_forge_body['world']['events'])
            if event.get('type')=='field-item-forged' and event.get('sourceEventId')==first_pagination_event_id),None)
        assert older_forge_event and older_forge_event['actor']['id']==witness_id and older_forge_event['actor']['role']=='witness'
        pagination_after_forge=read_state(visitor)
        assert pagination_after_forge['world']['revision']==pagination_before_navigation['world']['revision']+1
        assert pagination_after_forge['world']['xp']==pagination_before_navigation['world']['xp']
        assert pagination_after_forge['world']['events'][-1]['id']==older_forge_event['id']
        b.wait_for_function("()=>document.querySelector('[data-forge-slot=observation]')?.getAttribute('data-forge-source-page')==='0'")
        assert first_pagination_event_id not in [
            option.get_attribute('value') for option in b.locator('[data-forge-choice="observation"] option').all()
        ], 'a canonical revision change must reset the Forge cursor to the newest page'
        expect(b.locator(f'[data-field-item-id="{older_forge_event["itemId"]}"]')).to_be_visible()
        b.set_viewport_size({'width':390,'height':844})
        pagination_controls=b.locator('[data-forge-source-older="observation"]')
        pagination_bounds=pagination_controls.bounding_box()
        assert pagination_bounds and pagination_bounds['x']>=-1 and pagination_bounds['x']+pagination_bounds['width']<=390+1 and pagination_bounds['height']>=44, pagination_bounds
        assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')
        pagination_result={
            'sourceEventsAdded':101,
            'pageSize':100,
            'oldestSourceEventId':first_pagination_event_id,
            'oldestAbsentFromNewestPage':True,
            'oldestPresentOnOlderPage':True,
            'pageNavigationReadOnly':True,
            'actorScoped':True,
            'olderSourceForged':True,
            'revisionChangeResetCursor':True,
            'xpDelta':pagination_after_forge['world']['xp']-pagination_before_navigation['world']['xp']
        }

        close_sheet(a)
        a.locator('#logout-button').click()
        a.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        assert read_state(owner)['viewer']['role']=='witness'
        assert owner.request.post(url+'api/action',data={'type':'draft','kind':'loom','title':'No','intent':'No'}).status==403
        assert not errors,errors
        position_snapshot=read_state(visitor)
        position=position_snapshot['viewer']['position']
        assert position != {'x':180,'y':640}, f'Expected a non-spawn shared position before restart, got {position}'
        session_cookie=next((cookie['value'] for cookie in visitor.cookies(url) if cookie['name']=='ngl_session'),None)
        assert session_cookie and position_snapshot['viewer']['role']=='witness'
        recovery={
            'cookie':session_cookie,
            'actorId':position_snapshot['viewer']['id'],
            'position':position,
            'revision':position_snapshot['world']['revision'],
            'eventIds':[event['id'] for event in position_snapshot['world']['events']],
            'xp':position_snapshot['world']['xp'],
            'contributionCount':len(position_snapshot['world']['contributions']),
            'sourceObservationHandoff':handoff_recovery
        }
        result={'journey':'two-session-shared','passed':True,'errors':errors,'version':2,'kernelAccepted':2,'sourceObservatoryEmptyState':'Witness read-only wait; Founder-only Observatory recipe entry; both inspections preserve revision and XP','sourceObservationResponseDocket':'pending → exact version → author-only response → answered Chronicle','experimentChallengeAuthorResponse':'original Witness report author → retained challenge reply → lost HTTP response → exact The Relay retry → one event visible to both sessions; no XP or adjudication','guildNpcCollaboratorRelay':'Adversary NPC → source-bound packet → response committed → exact Relay retry → one retained response → next-role quest','walkableContradictionClerk':'fixed local adversary NPC → Guild Hall route → focused protocol card; approach and talk are read-only; explicit player report only','guildCouncilCoverage':'four role-specific retained attempts → collapsed source-bound Council dossier → Character Council skill 4; no XP or state mutation','commonsSocial':'TownSquare post → exact Relay retry → device-local mute/unmute → Witness private report → Founder hide/restore → retained history; no XP','commonsFieldSatchel':'Founder message → actor-scoped retained satchel item → TownSquare return action; Witness sees no foreign item; no XP or world mutation','playerGuildMembership':'Founder creates → Witness joins → occupied guild cannot be disbanded → Witness leaves → Founder closes; four retained events, no XP','playerAvatarInspection':{'targetRole':'founder','initialDistance':initial_player_distance,'routedBeforeExplicitInspection':routed_to_founder,'input':'pixel-world canvas avatar tap'},'playerGuildLeadership':'offer → decline → cancel → accept; both browser clients observe the retained decline event','sourceObservationHandoff':'downloaded notebook → fresh artifact preview/explicit restore → host review → actor/version-bound Chronicle event → exact replay no-op; no XP','decisionGate':'FOUNDER_NOT_ENROLLED; Founder and Witness readiness visible; Witness evaluation bytes and disposition controls withheld; no world revision or XP change','relayAutoRecovery':'same actor and exact request ID → online replay + shared re-entry replay → one retained report/event/revision; no XP','forgeInventory':'Witness Relay discovery → Forge item → 320px two-session offer/cancel/accept → current owner changes only after recipient acceptance; original creator/source persist; no XP','forgeSourcePagination':pagination_result,'stateReadRetries':state_read_retries['count']}
        return result,recovery
    finally:owner.close();visitor.close()



def forge_inventory_mobile(browser,url,out,width=390):
    errors=[]
    context=browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
    page=context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.goto(url,wait_until='networkidle')
        page.locator('#start-private').click()
        page.wait_for_function("()=>document.querySelector('#mode-label').textContent.toLowerCase().includes('private')")
        draft(page,'comic','Forge receipt source')
        page.locator('#publish-button').click()
        page.wait_for_function("()=>document.querySelector('#creation-count').textContent==='1'")
        before=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        publication=next(event for event in before['events'] if event['type']=='publish')
        before_xp=before['xp']
        before_revision=before['revision']

        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Quest Board")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Quest Board'&&!document.querySelector('#sheet').hidden",timeout=30000)
        forge_quest=page.locator('#sheet-content [data-objective-id="founder-forge-field-item"]')
        expect(forge_quest).to_have_count(1)
        expect(forge_quest.locator('.quest-step-state')).to_have_text('OPEN')
        expect(forge_quest).to_contain_text('0/1')
        quest_action=forge_quest.get_by_role('button',name='Go do this →',exact=True)
        quest_action.scroll_into_view_if_needed()
        quest_action_bounds=quest_action.bounding_box()
        assert quest_action_bounds and quest_action_bounds['x']>=-1 and quest_action_bounds['x']+quest_action_bounds['width']<=width+1, f'Forge quest action exceeds the {width}px viewport: {quest_action_bounds}'
        quest_action.click()
        # A quest destination is navigation, not an automatic workbench entry.
        wait_for_nearby_institution(page, 'forge')
        expect(page.locator('#sheet')).to_be_hidden()
        enter_nearby_institution(page, 'forge')
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Forge'&&!document.querySelector('#sheet').hidden",timeout=30000)
        expect(page.locator('[data-field-forge-root]')).to_be_visible()
        selector=page.locator('[data-forge-choice="provenance"]')
        expect(selector).to_have_count(1)
        source_ids=[option.get_attribute('value') for option in selector.locator('option').all()]
        assert publication['id'] in source_ids, 'The Forge must offer the exact retained publication event as a source'
        for control in [selector,page.locator('[data-forge-item="provenance"]')]:
            bounds=control.bounding_box()
            assert bounds and bounds['x']>=-1 and bounds['x']+bounds['width']<=width+1, f'Forge control exceeds the {width}px viewport: {bounds}'
        selector.select_option(publication['id'])
        page.locator('[data-forge-item="provenance"]').click()
        page.wait_for_function("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2')).events.some(event=>event.type==='field-item-forged')")
        forged_state=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        forge_events=[event for event in forged_state['events'] if event['type']=='field-item-forged']
        assert len(forge_events)==1
        forged=forge_events[0]
        assert forged['sourceEventId']==publication['id']
        assert forged['actor']['id']==publication['actor']['id']
        assert forged_state['revision']==before_revision+1
        assert forged_state['xp']==before_xp

        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Quest Board")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Quest Board'&&!document.querySelector('#sheet').hidden",timeout=30000)
        forge_quest=page.locator('#sheet-content [data-objective-id="founder-forge-field-item"]')
        expect(forge_quest.locator('.quest-step-state')).to_have_text('RECORDED')
        expect(forge_quest).to_contain_text('1/1')
        quest_evidence=forge_quest.locator('details.quest-evidence')
        expect(quest_evidence).to_have_count(1)
        quest_evidence.locator('summary').click()
        expect(quest_evidence).to_contain_text('item '+forged['itemId'])
        expect(quest_evidence).to_contain_text('slot provenance')
        expect(quest_evidence).to_contain_text('source event '+publication['id'])
        page.screenshot(path=str(out/f'forge-quest-board-mobile-{width}.png'))

        close_sheet(page)
        page.locator('#character-button').click()
        expect(page.locator('#sheet-title')).to_have_text('Character & field record')
        expect(page.locator('#sheet')).to_contain_text('Forger')
        expect(page.locator('#sheet')).to_contain_text('Armor Bearer')
        item=page.locator(f'[data-field-item-id="{forged["itemId"]}"]')
        expect(item).to_be_visible()
        equip_button=item.locator(f'[data-equip-forged-item="{forged["itemId"]}"]')
        equip_bounds=equip_button.bounding_box()
        assert equip_bounds and equip_bounds['x']>=-1 and equip_bounds['x']+equip_bounds['width']<=width+1, f'Equip control exceeds the {width}px viewport: {equip_bounds}'
        equip_button.click()
        page.wait_for_function("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2')).events.some(event=>event.type==='field-item-equipped')")
        equipped_state=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        assert equipped_state['revision']==before_revision+2
        assert equipped_state['xp']==before_xp
        expect(page.locator('[data-equipment-slot="provenance"]')).to_contain_text('Equipped')

        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Quest Board")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Quest Board'&&!document.querySelector('#sheet').hidden",timeout=30000)
        equip_quest=page.locator('#sheet-content [data-objective-id="founder-equip-field-item"]')
        expect(equip_quest).to_have_count(1)
        expect(equip_quest.locator('.quest-step-state')).to_have_text('RECORDED')
        expect(equip_quest).to_contain_text('1/1')
        equip_evidence=equip_quest.locator('details.quest-evidence')
        expect(equip_evidence).to_have_count(1)
        equip_evidence.locator('summary').click()
        expect(equip_evidence).to_contain_text('slot provenance')
        expect(equip_evidence).to_contain_text('source event '+forged['id'])
        page.screenshot(path=str(out/f'forge-equipment-quest-board-mobile-{width}.png'))
        close_sheet(page)
        page.locator('#character-button').click()
        expect(page.locator('#sheet-title')).to_have_text('Character & field record')

        unequip_button=page.locator('[data-equipment-slot="provenance"] [data-unequip-field-item="provenance"]')
        unequip_bounds=unequip_button.bounding_box()
        assert unequip_bounds and unequip_bounds['x']>=-1 and unequip_bounds['x']+unequip_bounds['width']<=width+1, f'Unequip control exceeds the {width}px viewport: {unequip_bounds}'
        unequip_button.click()
        page.wait_for_function("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2')).events.some(event=>event.type==='field-item-unequipped')")
        unequipped_state=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        assert unequipped_state['revision']==before_revision+3
        assert unequipped_state['xp']==before_xp
        assert len([event for event in unequipped_state['events'] if event['type']=='field-item-forged'])==1
        assert len([event for event in unequipped_state['events'] if event['type']=='field-item-equipped'])==1
        assert len([event for event in unequipped_state['events'] if event['type']=='field-item-unequipped'])==1
        expect(page.locator('[data-equipment-slot="provenance"]')).to_contain_text('Empty equipment slot')
        assert page.locator(f'[data-field-item-id="{forged["itemId"]}"]').count()==1, 'Unequipping must not consume or delete the item'

        page.reload(wait_until='networkidle')
        page.locator('#start-private').click()
        page.wait_for_function("()=>document.querySelector('#mode-label').textContent.toLowerCase().includes('private')")
        page.locator('#places-button').click()
        walk_to_location(page, "Quest Board")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Quest Board'&&!document.querySelector('#sheet').hidden",timeout=30000)
        reloaded_forge_quest=page.locator('#sheet-content [data-objective-id="founder-forge-field-item"]')
        expect(reloaded_forge_quest.locator('.quest-step-state')).to_have_text('RECORDED')
        expect(reloaded_forge_quest).to_contain_text('1/1')
        reloaded_equip_quest=page.locator('#sheet-content [data-objective-id="founder-equip-field-item"]')
        expect(reloaded_equip_quest.locator('.quest-step-state')).to_have_text('RECORDED')
        expect(reloaded_equip_quest).to_contain_text('1/1')
        reloaded_equip_evidence=reloaded_equip_quest.locator('details.quest-evidence')
        reloaded_equip_evidence.locator('summary').click()
        expect(reloaded_equip_evidence).to_contain_text('source event '+forged['id'])
        close_sheet(page)
        page.locator('#character-button').click()
        expect(page.locator(f'[data-field-item-id="{forged["itemId"]}"]')).to_be_visible()
        expect(page.locator('[data-equipment-slot="provenance"]')).to_contain_text('Empty equipment slot')
        page.screenshot(path=str(out/f'forge-inventory-mobile-{width}.png'))
        assert not errors,errors
        return {
            'journey':f'forge-inventory-mobile-{width}',
            'passed':True,
            'viewport':width,
            'forgedItems':1,
            'equipmentSelections':1,
            'equipmentRemovals':1,
            'questObjective':'founder-forge-field-item',
            'questProgress':'1/1',
            'equipmentQuestObjective':'founder-equip-field-item',
            'equipmentQuestProgress':'1/1',
            'equipmentQuestSourceEventId':forged['id'],
            'questEvidenceItemId':forged['itemId'],
            'questEvidenceSourceEventId':publication['id'],
            'xpDelta':unequipped_state['xp']-before_xp,
            'revisionDelta':unequipped_state['revision']-before_revision,
            'sourceEventId':publication['id'],
            'itemEventId':forged['id'],
            'reloadRecovery':'inventory-and-quest-retained',
            'errors':errors
        }
    finally:
        context.close()


def launchpad(page,url,out,label):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(url,wait_until='networkidle');page.locator('#caveman-launch').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent==='3'")
    page.locator('#download-stage').wait_for()
    stage=page.frame_locator('#artifact-frame')
    stage.locator('details summary').first.click()
    assert stage.frame_locator('iframe').first.locator('img').first.evaluate('(img)=>img.decode().then(()=>img.naturalWidth>0)')
    assert page.locator('#sheet .check-list li.failed').count()==0
    with page.expect_download() as downloaded:page.locator('#download-stage').click()
    downloaded.value.save_as(str(out/f'{label}-exhibition.html'))
    page.screenshot(path=str(out/f'{label}-stage.png'))
    page.locator('#portal-close').click();close_sheet(page)
    page.locator('#world').focus()
    page.keyboard.down('ArrowRight')
    page.wait_for_timeout(350)
    page.keyboard.up('ArrowRight')
    page.wait_for_function("""()=>{try{const saved=JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')||'null');return saved?.schema==='ngl.player-position.v1'&&saved.x>180;}catch{return false}}""")
    page.locator('#journal-button').click()
    with page.expect_download() as saved:page.locator('#export-world').click()
    private_save=json.loads(Path(saved.value.path()).read_text())
    assert isinstance(private_save,dict) and private_save.get('schema')=='ngl.private-save.v1'
    assert set(private_save)=={'schema','world','playerPosition'}
    world=private_save['world']
    position=private_save['playerPosition']
    assert isinstance(position,dict) and set(position)=={'x','y'}
    assert type(position['x']) in (int,float) and type(position['y']) in (int,float)
    assert 0<=position['x']<=1600 and 0<=position['y']<=1000 and position['x']>180
    stored_position=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))")
    assert stored_position=={'schema':'ngl.player-position.v1','x':position['x'],'y':position['y']}
    assert len(world['creations'])==3 and world['xp']==300
    before_rejected_world=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
    tampered_save={**private_save,'playerPosition':{**position,'id':'forged-player'}}
    page.locator('#import-world').set_input_files({'name':'tampered-world.json','mimeType':'application/json','buffer':json.dumps(tampered_save).encode()})
    page.wait_for_function("()=>document.querySelector('#toast')?.textContent.includes('invalid character position')")
    after_rejected_world=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
    after_rejected_position=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))")
    assert after_rejected_world==before_rejected_world==world
    assert after_rejected_position==stored_position
    assert page.locator('#creation-count').text_content()=='3'
    page.locator('#import-world').set_input_files({'name':'world.json','mimeType':'application/json','buffer':json.dumps(private_save).encode()})
    page.wait_for_function("()=>document.querySelector('#sheet').hidden")
    page.reload(wait_until='networkidle');page.locator('#start-private').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent==='3'")
    restored_position=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))")
    assert restored_position=={'schema':'ngl.player-position.v1','x':position['x'],'y':position['y']}
    page.locator('#world').focus()
    page.keyboard.down('ArrowRight')
    page.wait_for_timeout(220)
    page.keyboard.up('ArrowRight')
    page.wait_for_function("(expectedX)=>{try{const saved=JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')||'null');return saved?.schema==='ngl.player-position.v1'&&saved.x>expectedX;}catch{return false}}",arg=position['x'])
    moved_position=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))")
    assert moved_position['x']>position['x'] and moved_position['y']==position['y']
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(out/f'{label}-world.png'))
    assert not errors,errors
    return {'journey':label,'passed':True,'artifacts':3,'checks':12,'positionRoundTrip':True,'invalidPositionImportRejected':True,'errors':errors}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass



def offline_pwa(browser,url,out):
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,service_workers='allow')
    page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.goto(url,wait_until='networkidle')
        expect(page.locator('link[rel="manifest"]')).to_have_attribute('href','./manifest.webmanifest')
        try:
            page.wait_for_function("async()=>{const registration=await navigator.serviceWorker?.getRegistration?.();return registration?.active?.state==='activated';}",timeout=15000)
        except Exception as error:
            state=page.evaluate("async()=>{const serviceWorker=navigator.serviceWorker;const registration=await serviceWorker?.getRegistration?.();return {supported:!!serviceWorker,scope:registration?.scope,installing:registration?.installing?.state,waiting:registration?.waiting?.state,active:registration?.active?.state};}")
            raise AssertionError(f'Offline shell service worker did not activate: {state}') from error
        page.reload(wait_until='networkidle')
        page.wait_for_function("()=>Boolean(navigator.serviceWorker?.controller)",timeout=10000)
        cache_state=page.evaluate("""async()=>{const names=await caches.keys();const paths=[];for(const name of names){for(const request of await (await caches.open(name)).keys())paths.push(new URL(request.url).pathname);}return {names,paths};}""")
        assert '/pixel-world-view.mjs' in cache_state['paths'], 'PixelWorldView is not in the installed offline shell'
        assert '/guild-npc-workbench.mjs' in cache_state['paths'], 'Guild NPC workbench is not in the installed offline shell'
        # Remove the ordinary HTTP cache so the offline reload must use Cache Storage.
        cdp=context.new_cdp_session(page)
        cdp.send('Network.enable')
        cdp.send('Network.clearBrowserCache')
        context.set_offline(True)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function("()=>typeof document.querySelector('#start-private').onclick==='function'")
        page.locator('#start-private').click()
        page.wait_for_function("()=>document.querySelector('#mode-label').textContent.toLowerCase().includes('private')",timeout=10000)
        assert 'offline' in (page.locator('#connection-dot').get_attribute('class') or '').split(), 'Private world must visibly report an offline network state'
        assert 'Offline' in (page.locator('#connection-dot').get_attribute('title') or '')
        draft(page,'loom','Offline field instrument')
        page.locator('#publish-button').click()
        page.wait_for_function("()=>document.querySelector('#creation-count').textContent==='1'")
        draft(page,'observatory','Offline research notebook')
        page.locator('#preview-button').click()
        frame=page.frame_locator('#artifact-frame')
        expect(frame.locator('html')).to_have_attribute('data-ngl-ready', 'true')
        expect(page.locator('#artifact-frame')).to_have_attribute('aria-busy', 'false')
        expect(page.locator('#artifact-frame')).to_have_attribute('data-ngl-input-ready', 'true')
        frame.locator('#claim').fill('<b>Offline recovery note</b>')
        frame.locator('#source-kind').select_option('model-assertion')
        frame.locator('#source').fill('User-selected offline backup fixture; no source retrieved.')
        frame.locator('#falsifier').fill('A direct observation contradicts the note.')
        frame.locator('#uncertainty').fill('No independent observation.')
        frame.locator('#next-test').fill('Inspect the cited source.')
        frame.locator('#add-observation').click()
        expect(frame.locator('#observations article')).to_have_count(1)
        with page.expect_download() as backup_download:
            frame.locator('#download').click()
        backup_path=backup_download.value.path()
        backup=json.loads(Path(backup_path).read_text())
        assert backup['schema']=='ngl.source-observatory.v2'
        assert backup['observations'][0]['claim']=='<b>Offline recovery note</b>'
        assert backup['assurance']['sourceRetrieval']=='NOT_PERFORMED'
        assert backup['assurance']['independentVerification']=='NOT_PERFORMED'
        assert backup['assurance']['modelAssertions']=='LEADS_ONLY'
        page.locator('#portal-close').click()
        page.locator('#publish-button').click()
        page.wait_for_function("()=>document.querySelector('#creation-count').textContent==='2'")
        api_network_only=page.evaluate("async()=>{try{await fetch('/api/state');return false;}catch{return true;}}")
        assert api_network_only, 'Offline shell must not synthesize or cache shared API state'
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function("()=>typeof document.querySelector('#start-private').onclick==='function'")
        expect(page.locator('#doorway')).to_be_visible()
        page.locator('#start-private').click()
        page.wait_for_function("()=>document.querySelector('#mode-label').textContent.toLowerCase().includes('private')")
        assert page.locator('#creation-count').text_content()=='2', 'Private progress did not survive an offline reload'
        visit(page,'Offline research notebook')
        private_history_disclosure=page.locator('#source-observations [data-source-observation-attribution-disclosure="private"]')
        expect(private_history_disclosure).to_be_visible()
        expect(private_history_disclosure).to_contain_text('not an authenticated identity')
        expect(private_history_disclosure).to_contain_text('recompute SHA-256')
        page.locator('#source-observation-open').click()
        private_form_disclosure=page.locator('[data-source-observation-attribution-disclosure="private"]')
        expect(private_form_disclosure).to_be_visible()
        expect(private_form_disclosure).to_contain_text('LOCAL ATTRIBUTION ONLY')
        close_sheet(page)
        visit(page,'Offline research notebook')
        page.locator('#enter-creation').click()
        frame=page.frame_locator('#artifact-frame')
        expect(frame.locator('html')).to_have_attribute('data-ngl-ready', 'true')
        expect(page.locator('#artifact-frame')).to_have_attribute('aria-busy', 'false')
        expect(page.locator('#artifact-frame')).to_have_attribute('data-ngl-input-ready', 'true')
        world_before_restore=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        assert world_before_restore['xp']==200
        expect(frame.locator('#observations article')).to_have_count(0)
        frame.locator('#backup-file').set_input_files(backup_path)
        restore_locked=frame.locator('#preview-restore').evaluate("button=>{button.click();const locked=button.disabled;button.click();return locked;}")
        assert restore_locked, 'Concurrent preview taps must be serialized'
        expect(frame.locator('#restore-preview')).to_contain_text('Offline recovery note')
        expect(frame.locator('#restore-preview')).to_contain_text('user-supplied declarations')
        expect(frame.locator('#restore-preview b')).to_have_count(0)
        expect(frame.locator('#observations article')).to_have_count(0)
        expect(frame.locator('#restore')).to_be_enabled()
        frame.locator('#restore').click()
        expect(frame.locator('#observations article')).to_have_count(1)
        expect(frame.locator('#observations')).to_contain_text('Model assertion: lead only, not evidence.')
        expect(frame.locator('#observations')).to_contain_text('Restored from a user-selected backup · original authorship not independently verified')
        expect(frame.locator('#status')).to_contain_text('not canonical events, evidence, XP or approval')
        world_after_restore=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        assert world_after_restore==world_before_restore, 'Notebook restore must not mutate the private world projection'
        expect(page.locator('#creation-count')).to_have_text('2')
        expect(page.locator('#xp-count')).to_have_text('200')
        frame.locator('#backup-file').set_input_files(backup_path)
        frame.locator('#preview-restore').click()
        expect(frame.locator('#status')).to_contain_text('No new notes')
        expect(frame.locator('#restore')).to_be_disabled()
        expect(frame.locator('#observations article')).to_have_count(1)
        world_after_replay=page.evaluate("()=>JSON.parse(localStorage.getItem('ngl.common-ground.v2'))")
        assert world_after_replay==world_before_restore, 'Exact backup replay must remain world-state neutral'
        with page.expect_download() as restored_download:
            frame.locator('#download').click()
        restored_notes=json.loads(Path(restored_download.value.path()).read_text())
        assert restored_notes['observations'][0]['claim']=='<b>Offline recovery note</b>'
        assert restored_notes['assurance']['sourceRetrieval']=='NOT_PERFORMED'
        page.locator('#portal-close').click()
        close_sheet(page)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        return {'journey':'offline-pwa-private-recovery','passed':True,'cachedEntries':len(cache_state['paths']),'connection_status':'offline','shared_api':'network-only','private_publications':2,'notebookRestores':1,'notebookReplayNoOps':1,'notebookWorldMutation':False}
    finally:
        context.close()

def combat_yard(browser,url,out):
    errors=[]
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
    page=context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.goto(url,wait_until='networkidle')
        page.locator('#start-private').click()
        page.locator('#world').wait_for(state='visible')
        control=page.locator('[data-guild-npc-control="combat-marshal"]')
        expect(control).to_have_count(1)
        snapshot="() => {const raw=localStorage.getItem('ngl.common-ground.v2');const value=raw===null?{revision:0,events:[],xp:0}:JSON.parse(raw);return {revision:value.revision,events:value.events.map(event=>({id:event.id,type:event.type,locationId:event.locationId,actorId:event.actor?.id,encounterId:event.encounterId,opponentId:event.opponentId,move:event.move})),actorId:localStorage.getItem('ngl.common-ground.v2.actor'),xp:value.xp,persisted:raw!==null}}"
        before=page.evaluate(snapshot)
        control.evaluate("(button)=>button.click()")
        page.wait_for_function("(role)=>Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button=>button.dataset.guildNpcControl===role&&button.dataset.guildNpcAction==='talk')",arg='combat-marshal')
        after_approach=page.evaluate(snapshot)
        previous_ids={event['id'] for event in before['events']}
        travel_events=[event for event in after_approach['events'] if event['id'] not in previous_ids]
        allowed_guides={'relay','river','overlook','ruins'}
        assert all(event['type']=='discover' and event['locationId'] in allowed_guides and event['actorId']==before['actorId'] for event in travel_events),travel_events
        assert after_approach['revision']==before['revision']+len(travel_events)
        assert after_approach['xp']==before['xp']
        control.evaluate("(button)=>button.click()")
        page.wait_for_selector('[data-combat-yard-panel]')
        panel=page.locator('[data-combat-yard-panel]')
        assert panel.get_attribute('data-combat-status')=='idle'
        assert panel.get_attribute('data-combat-xp')=='0'
        after_talk=page.evaluate(snapshot)
        assert after_talk==after_approach, 'approaching or talking to the fixed Marshal must not create a canonical event or XP'
        page.locator('[data-combat-opponent="yard-scout"]').click()
        page.wait_for_function("()=>document.querySelector('[data-combat-yard-panel]')?.dataset.combatStatus==='active'")
        for move,phase in [('feint','strike'),('guard','recovery'),('strike','windup'),('feint','strike'),('guard','recovery')]:
            page.locator(f'[data-combat-move="{move}"]').click()
            page.wait_for_function("(expected)=>document.querySelector('[data-combat-yard-panel]')?.dataset.combatPhase===expected",arg=phase)
        page.locator('[data-combat-move="strike"]').click()
        page.wait_for_function("()=>document.querySelector('[data-combat-yard-panel]')?.dataset.combatStatus==='victory'")
        assert panel.get_attribute('data-combat-xp')=='30'
        assert panel.get_attribute('data-combat-victories')=='1'
        after_victory=page.evaluate(snapshot)
        prior_ids={event['id'] for event in after_talk['events']}
        encounter_events=[event for event in after_victory['events'] if event['id'] not in prior_ids]
        assert len(encounter_events)==7,encounter_events
        assert [event['type'] for event in encounter_events]==['combat-encounter-started']+['combat-move-resolved']*6
        assert [event['move'] for event in encounter_events[1:]]==['feint','guard','strike','feint','guard','strike']
        assert len({event['encounterId'] for event in encounter_events})==1,encounter_events
        assert encounter_events[0]['opponentId']=='yard-scout'
        assert all(event['actorId']==before['actorId'] for event in encounter_events)
        assert len({event['id'] for event in after_victory['events']})==len(after_victory['events'])
        assert after_victory['revision']==after_talk['revision']+len(encounter_events)
        assert after_victory['xp']==after_talk['xp']
        assert after_victory['persisted'] is True
        close_sheet(page)
        page.locator('#places-button').click()
        walk_to_location(page, "Quest Board")
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Quest Board'")
        expect(page.locator('#sheet')).to_contain_text('Win a deterministic Combat Yard training encounter')
        expect(page.locator('#sheet')).to_contain_text('Defeat the Training Warden in the Combat Yard')
        expect(page.locator('#sheet')).to_contain_text('Defeat the Training Champion in the Combat Yard')
        close_sheet(page)
        page.locator('#character-button').click()
        expect(page.locator('[data-skill-id="combatant"]')).to_contain_text('1 recorded')
        assert not errors,errors
        page.screenshot(path=str(out/'combat-yard-mobile.png'))
        return {'journey':'combat_yard_mobile','status':'passed','first_victory_xp':30,'combatant_skill_count':1,'errors':errors}
    finally:
        context.close()



def combat_yard_shared(browser,out):
    errors=[]
    with tempfile.TemporaryDirectory(prefix='ngl-combat-yard-shared-') as data:
        process,url=launch_server(data)
        founder=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
        witness=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
        try:
            founder_page=founder.new_page()
            witness_page=witness.new_page()
            for page in [founder_page,witness_page]:
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(url,wait_until='networkidle')
                page.locator('#start-shared').click()
                page.wait_for_function("()=>document.querySelector('#mode-label')?.textContent.includes('Witness')",timeout=15000)

            founder_page.locator('#login-button').click()
            founder_page.locator('#founder-key').fill(KEY)
            founder_page.locator('#verify-founder').click()
            founder_page.wait_for_function("()=>document.querySelector('#mode-label')?.textContent.includes('Founder')",timeout=15000)

            def read_state(context):
                response=context.request.get(url+'api/state',timeout=10000)
                assert response.status==200,response.text()
                return response.json()

            witness_spawn=read_state(witness)
            assert witness_spawn['viewer']['role']=='witness'
            denied_at_spawn=witness.request.post(url+'api/action',data={
                'type':'start-combat-encounter','opponentId':'yard-scout',
                'requestId':'shared-combat-spawn-001'
            })
            assert denied_at_spawn.status==409,denied_at_spawn.text()
            assert denied_at_spawn.json()['error']['code']=='COMBAT_YARD_REQUIRED'
            after_spawn_denial=read_state(witness)
            assert after_spawn_denial['world']['revision']==witness_spawn['world']['revision']
            assert not any(event.get('type','').startswith('combat-') for event in after_spawn_denial['world']['events'])

            def walk_to_yard(page):
                close_sheet(page)
                page.locator('#places-button').click()
                walk_to_location(page, "Combat Yard")
                page.wait_for_selector('[data-combat-yard-panel]',timeout=30000)
                page.wait_for_function("""async()=> {
                    const response=await fetch('/api/state',{cache:'no-store',credentials:'same-origin'});
                    if(!response.ok)return false;
                    const state=await response.json();
                    const position=state.viewer?.position;
                    return !!position&&Math.hypot(position.x-620,position.y-790)<=160;
                }""",timeout=30000)
                return page.locator('[data-combat-yard-panel]')

            founder_panel=walk_to_yard(founder_page)
            witness_panel=walk_to_yard(witness_page)
            founder_before=read_state(founder)
            witness_before=read_state(witness)
            founder_actor=founder_before['viewer']
            witness_actor=witness_before['viewer']
            assert founder_actor['id']=='damien' and founder_actor['role']=='founder'
            assert witness_actor['role']=='witness' and witness_actor['id']!=founder_actor['id']
            for state in [founder_before,witness_before]:
                position=state['viewer']['position']
                distance=math.hypot(position['x']-620,position['y']-790)
                assert distance<=160, {
                    'actorId':state['viewer'].get('id'),
                    'role':state['viewer'].get('role'),
                    'position':position,
                    'target':{'x':620,'y':790},
                    'distance':distance
                }
            assert founder_panel.get_attribute('data-combat-status')=='idle'
            assert witness_panel.get_attribute('data-combat-status')=='idle'

            founder_page.locator('[data-combat-opponent="yard-scout"]').click()
            founder_page.wait_for_function("()=>document.querySelector('[data-combat-yard-panel]')?.dataset.combatStatus==='active'",timeout=15000)
            founder_encounter=founder_panel.locator('[data-combat-encounter]').get_attribute('data-combat-encounter')
            assert founder_encounter
            founder_started=read_state(founder)
            founder_start_event=next(event for event in founder_started['world']['events'] if event.get('type')=='combat-encounter-started')
            assert founder_start_event['encounterId']==founder_encounter
            assert founder_start_event['actor']['id']==founder_actor['id']
            assert founder_start_event['actor']['role']=='founder'

            witness_panel=walk_to_yard(witness_page)
            assert witness_panel.get_attribute('data-combat-status')=='idle'
            assert witness_page.locator(f'[data-combat-encounter="{founder_encounter}"]').count()==0
            foreign_move=witness.request.post(url+'api/action',data={
                'type':'combat-move','encounterId':founder_encounter,'move':'feint',
                'requestId':'shared-combat-foreign-001'
            })
            assert foreign_move.status==403,foreign_move.text()
            assert foreign_move.json()['error']['code']=='COMBAT_ACTOR_MISMATCH'
            after_foreign=read_state(founder)
            assert len([event for event in after_foreign['world']['events'] if event.get('type','').startswith('combat-')])==1

            witness_page.locator('[data-combat-opponent="yard-scout"]').click()
            witness_page.wait_for_function("()=>document.querySelector('[data-combat-yard-panel]')?.dataset.combatStatus==='active'",timeout=15000)
            witness_encounter=witness_panel.locator('[data-combat-encounter]').get_attribute('data-combat-encounter')
            assert witness_encounter and witness_encounter!=founder_encounter
            witness_started=read_state(witness)
            witness_start_event=next(event for event in witness_started['world']['events'] if event.get('type')=='combat-encounter-started' and event.get('actor',{}).get('id')==witness_actor['id'])
            assert witness_start_event['encounterId']==witness_encounter
            assert witness_start_event['actor']['role']=='witness'

            def finish_encounter(page,panel):
                for move,phase in [('feint','strike'),('guard','recovery'),('strike','windup'),('feint','strike'),('guard','recovery')]:
                    page.locator(f'[data-combat-move="{move}"]').click()
                    page.wait_for_function("(expected)=>document.querySelector('[data-combat-yard-panel]')?.dataset.combatPhase===expected",arg=phase,timeout=10000)
                page.locator('[data-combat-move="strike"]').click()
                page.wait_for_function("()=>document.querySelector('[data-combat-yard-panel]')?.dataset.combatStatus==='victory'",timeout=10000)
                assert panel.get_attribute('data-combat-xp')=='30'
                assert panel.get_attribute('data-combat-victories')=='1'

            finish_encounter(founder_page,founder_panel)
            finish_encounter(witness_page,witness_panel)

            final_founder=read_state(founder)
            final_witness=read_state(witness)
            world=final_founder['world']
            assert final_witness['world']['revision']==world['revision']
            assert [event['id'] for event in final_witness['world']['events']]==[event['id'] for event in world['events']]
            assert world['revision']==len(world['events'])
            assert world['xp']==0,'Combat XP must not mutate publication-only world XP'
            combat_events=[event for event in world['events'] if event.get('type','').startswith('combat-')]
            assert len(combat_events)==14,combat_events
            assert len({event['id'] for event in combat_events})==14
            for actor,encounter_id in [(founder_actor,founder_encounter),(witness_actor,witness_encounter)]:
                own=[event for event in combat_events if event.get('actor',{}).get('id')==actor['id'] and event.get('actor',{}).get('role')==actor['role']]
                assert len(own)==7,own
                assert own[0]['type']=='combat-encounter-started' and own[0]['encounterId']==encounter_id
                assert [event['type'] for event in own[1:]]==['combat-move-resolved']*6
                assert [event['move'] for event in own[1:]]==['feint','guard','strike','feint','guard','strike']
                assert all(event['encounterId']==encounter_id for event in own)

            def inspect_character(page,context,role):
                page.reload(wait_until='networkidle')
                page.locator('#start-shared').click()
                page.wait_for_function("(expected)=>document.querySelector('#mode-label')?.textContent.includes(expected)",arg='Founder' if role=='founder' else 'Witness',timeout=15000)
                page.locator('#character-button').click()
                expect(page.locator('[data-skill-id="combatant"]')).to_contain_text('1 recorded')
                expect(page.locator('#sheet')).to_contain_text('30 character XP')
                after=read_state(context)['world']
                assert after['revision']==world['revision']
                assert [event['id'] for event in after['events']]==[event['id'] for event in world['events']]
                assert after['xp']==0
                close_sheet(page)

            inspect_character(founder_page,founder,'founder')
            inspect_character(witness_page,witness,'witness')
            assert not errors,errors
            founder_page.screenshot(path=str(out/'combat-yard-shared-mobile.png'))
            return {
                'journey':'combat_yard_shared_mobile','status':'passed',
                'actors':[{'id':founder_actor['id'],'role':'founder'},{'id':witness_actor['id'],'role':'witness'}],
                'encounters':2,'retainedCombatEvents':14,'firstVictoryXpPerActor':30,
                'publicationWorldXp':0,'foreignMoveDenied':True,
                'spawnStartDenied':True,'characterProjectionReloaded':True,
                'readOnlyInspection':True,'errors':errors
            }
        finally:
            founder.close()
            witness.close()
            stop_server(process)




def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',default='/tmp/ngl-meteor-browser');parser.add_argument('--standalone',action='store_true')
    args=parser.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True);results=[]
    def record(result):
        results.append(result)
        (out/'results.json').write_text(json.dumps(results,indent=2))
        print(json.dumps(result),flush=True)
    with tempfile.TemporaryDirectory(prefix='ngl-browser-service-') as data:
        process,url=launch_server(data)
        try:
            with sync_playwright() as playwright:
                browser=playwright.chromium.launch(executable_path=os.environ.get('NGL_CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox'])
                try:
                    record(offline_pwa(browser,url,out))
                    for label,viewport,mobile in [('desktop',{'width':1440,'height':1000},False),('phone',{'width':390,'height':844},True)]:
                        context=browser.new_context(viewport=viewport,is_mobile=mobile,has_touch=mobile,reduced_motion='reduce' if mobile else 'no-preference',accept_downloads=True)
                        page=context.new_page()
                        try:record(basic(page,url,out,label))
                        except Exception:
                            page.screenshot(path=str(out/f'failed-{label}.png'));raise
                        finally:context.close()
                    record(institutional_locations(browser,url,out))
                    record(combat_yard(browser,url,out))
                    for width in [320,390]:record(forge_inventory_mobile(browser,url,out,width))
                    shared_result,shared_position_recovery=shared(browser,url,data,out)
                    record(shared_result)
                    record(combat_yard_shared(browser,out))
                    for width in [320,360,412]:record(phone_toolbar_layout(browser,url,width))
                    for width in [320,412]:
                        context=browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce',accept_downloads=True)
                        page=context.new_page()
                        try:record(launchpad(page,url,out,f'one-button-{width}'))
                        except Exception as error:
                            page.screenshot(path=str(out/f'failed-one-button-{width}.png'))
                            (out/'failure.json').write_text(json.dumps({'journey':f'one-button-{width}','passed':False,'error':str(error)},indent=2))
                            raise
                        finally:context.close()
                    if args.standalone:
                        context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
                        page=context.new_page();requests=[];failed_requests=[];page_errors=[];console_errors=[];page_crashes=[]
                        page.on('request',lambda request:requests.append(request.url))
                        page.on('crash',lambda:page_crashes.append({'url':page.url}))
                        page.on('requestfailed',lambda request:failed_requests.append({'url':request.url,'failure':request.failure}))
                        page.on('pageerror',lambda error:page_errors.append(str(error)))
                        page.on('console',lambda message:console_errors.append(message.text) if message.type=='error' else None)
                        page.set_default_timeout(12000)
                        file_url=(ROOT/'dist/play.html').as_uri()
                        try:
                            try:
                                record(basic(page,file_url,out,'standalone-file'))
                            except Exception as error:
                                try:
                                    dom_probe=page.locator('html').evaluate("""el => {
                                        const button=el.querySelector('#start-private');
                                        const buttons=[...el.querySelectorAll('button')].slice(0,12).map(item=>{
                                            const rect=item.getBoundingClientRect(),style=getComputedStyle(item);
                                            return {id:item.id,text:item.innerText,ariaLabel:item.getAttribute('aria-label'),hidden:item.hidden,disabled:item.disabled,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},display:style.display,visibility:style.visibility};
                                        });
                                        return {readyState:document.readyState,bodyText:document.body?.innerText?.slice(0,1200)||null,buttonCount:el.querySelectorAll('button').length,startPrivate:button?.outerHTML||null,buttons};
                                    }""",timeout=1500)
                                except Exception as probe_error:
                                    dom_probe={'error':str(probe_error)}
                                try:
                                    body_text=page.locator('body').inner_text(timeout=1000)
                                    body_text_error=None
                                except Exception as body_error:
                                    body_text=None
                                    body_text_error=str(body_error)
                                diagnostic={
                                    'error':str(error),'url':page.url,'title':page.title(),
                                    'bodyText':body_text[:1200] if isinstance(body_text,str) else None,
                                    'bodyTextError':body_text_error,'domProbe':dom_probe,
                                    'pageClosed':page.is_closed(),'pageCrashes':page_crashes,
                                    'failedRequests':failed_requests,'pageErrors':page_errors,
                                    'consoleErrors':console_errors
                                }
                                try:page.screenshot(path=str(out/'standalone-file-failure.png'))
                                except Exception as screenshot_error:diagnostic['screenshotError']=str(screenshot_error)
                                (out/'standalone-file-diagnostic.json').write_text(json.dumps(diagnostic,indent=2))
                                administrator_block=(
                                    'ERR_BLOCKED_BY_ADMINISTRATOR' in str(error) or
                                    any('ERR_BLOCKED_BY_ADMINISTRATOR' in (item.get('failure') or '') for item in failed_requests)
                                )
                                if administrator_block:
                                    record({
                                        'journey':'standalone-file','status':'blocked',
                                        'reason':'Chromium explicitly blocked local file navigation by administrator policy.',
                                        'failedRequests':failed_requests
                                    })
                                else:
                                    raise AssertionError('Standalone file did not expose the game shell: '+json.dumps(diagnostic)) from error
                            assert not [u for u in requests if u.startswith(('http:','https:'))], 'Standalone fetched network content'
                        finally:context.close()
                        # Serve the exact packaged bytes with no added CSP; this is distinct from a file:// check.
                        static=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT/'dist')))
                        threading.Thread(target=static.serve_forever,daemon=True).start()
                        packaged=f'http://127.0.0.1:{static.server_address[1]}/play.html'
                        try:
                            context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
                            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
                            record(launchpad(page,packaged,out,'standalone-exact-bytes'))
                            assert all(u==packaged or u.startswith(('data:','blob:')) for u in requests),requests
                            context.close()
                        finally:static.shutdown();static.server_close()
                    # Reopen the same service data directory and resume the exact Witness
                    # browser identity. Position is private auxiliary state, not a world event.
                    stop_server(process);process,url=launch_server(data)
                    fresh=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
                    try:
                        fresh.add_cookies([{'name':'ngl_session','value':shared_position_recovery['cookie'],'url':url,'httpOnly':True,'sameSite':'Strict'}])
                        page=fresh.new_page()
                        page.goto(url,wait_until='networkidle')
                        page.locator('#start-shared').click()
                        page.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
                        state_response=fresh.request.get(url+'api/state')
                        assert state_response.status==200
                        restored=state_response.json()
                        assert restored['viewer']['role']=='witness'
                        assert restored['viewer']['id']==shared_position_recovery['actorId']
                        assert restored['viewer']['position']==shared_position_recovery['position']
                        assert restored['world']['revision']==shared_position_recovery['revision']
                        assert [event['id'] for event in restored['world']['events']]==shared_position_recovery['eventIds']
                        assert restored['world']['xp']==shared_position_recovery['xp']
                        assert restored['world']['creations'][0]['version']==2
                        assert len(restored['world']['contributions'])==shared_position_recovery['contributionCount'] and len(restored['world']['reports'])==3
                        assert all(report['version']==1 for report in restored['world']['reports'])
                        handoff=shared_position_recovery['sourceObservationHandoff']
                        handoff_events=[event for event in restored['world']['events'] if event['type']=='source-observation-recorded' and event.get('observationId')==handoff['observationId']]
                        assert len(handoff_events)==1
                        retained_handoff=handoff_events[0]
                        assert retained_handoff['id']==handoff['eventId']
                        assert retained_handoff['actor']['id']==handoff['actorId'] and retained_handoff['actor']['role']==handoff['actorRole']
                        assert retained_handoff['creationId']==handoff['creationId'] and retained_handoff['version']==handoff['version']
                        assert retained_handoff['modelAssertions']=='LEADS_ONLY' and retained_handoff['independentVerification']=='NOT_PERFORMED'
                        assert sum(report.get('text')=='Reconnect must replay this exact report once.' for report in restored['world']['reports'])==1
                        structured=[report for report in restored['world']['reports'] if report.get('text','').startswith('CONTRADICTION CLERK · STRUCTURED CHALLENGE')]
                        assert len(structured)==1 and 'REPORT ONLY — NOT A VERDICT' in structured[0]['text']
                    finally:fresh.close()
                    unrelated=browser.new_context()
                    try:
                        unrelated_state=unrelated.request.get(url+'api/state').json()
                        assert unrelated_state['viewer']['id']!=shared_position_recovery['actorId']
                        assert unrelated_state['viewer']['position']=={'x':180,'y':640}, 'a new pseudonymous session must not inherit the resumed actor position'
                    finally:unrelated.close()
                    record({'journey':'shared-restart','passed':True,'retainedVersion':2,'reports':3,'reconnectReplayRetained':True,'actorScopedPositionRestored':True,'worldRevisionUnchanged':True,'xpUnchanged':True,'sourceObservationHandoffRetained':True,'unrelatedSessionStartsAtSpawn':True})
                finally:browser.close()
        finally:stop_server(process)
    (out/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))


if __name__=='__main__':main()
