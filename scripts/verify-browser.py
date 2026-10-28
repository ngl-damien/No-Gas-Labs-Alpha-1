"""Actual Chromium acceptance against a disposable Node service and packaged offline file.

Requires Python Playwright plus Chromium for development only. No provider keys or public posts.
"""
import argparse
import os
import json
import re
import select
import subprocess
import tempfile
import functools
import http.server
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

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


def close_sheet(page):
    if page.locator('#sheet').is_visible():
        page.locator('#sheet-close').click()
        expect(page.locator('#sheet')).to_be_hidden()


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
    page.goto(url,wait_until='networkidle')
    page.locator('#start-private').click()
    page.locator('#world').wait_for(state='visible')
    page.wait_for_function("()=>document.querySelector('#mode-label').textContent.toLowerCase().includes('private')")
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
    page.locator('#places-button').click()
    page.get_by_role('button',name='Walk to Guild Hall',exact=True).click()
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
    expect(page.locator('#xp-count')).to_have_text('200')
    close_sheet(page)
    page.locator('#places-button').click()
    page.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
    page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
    expect(page.locator('#sheet')).to_contain_text('CONTRADICTION CLERK · STRUCTURED CHALLENGE')
    expect(page.locator('#sheet')).to_contain_text('REPORT ONLY — NOT A VERDICT')
    expect(page.locator('#xp-count')).to_have_text('200')
    close_sheet(page)
    page.screenshot(path=str(out/f'{label}.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
    page.reload(wait_until='networkidle');page.locator('#start-private').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('2')")
    assert not errors,errors
    return {'journey':label,'passed':True,'errors':errors}


def visit(page,title):
    close_sheet(page);page.locator('#places-button').click()
    page.get_by_role('button',name=f'Open {title}',exact=True).click()


def institutional_locations(browser,url,out):
    errors=[]
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
    page=context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.goto(url,wait_until='networkidle')
        page.locator('#start-private').click()
        page.locator('#world').wait_for(state='visible')
        cases=[
            ('The Relay','Carry the question.','Draft a portable request →'),
            ('River of Receipts','The river remembers bytes.','Build a source observatory →'),
            ('The Long View','Make room for another voice.','Make a first place to preserve →'),
            ('The Unfinished','Unfinished is a useful state.','Give the recovered comic a home →')
        ]
        for place,title,label in cases:
            close_sheet(page)
            page.locator('#places-button').click()
            page.get_by_role('button',name=f'Walk to {place}',exact=True).click()
            page.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg=title)
            expect(page.locator('#sheet .primary-button')).to_have_text(label)
            assert page.locator('#creation-count').text_content()=='0', 'Selecting a location must not create an artifact'
            assert page.locator('#xp-count').text_content()=='0', 'Selecting a location must not award XP'
        close_sheet(page)
        page.locator('#places-button').click()
        page.get_by_role('button',name='Walk to Guild Hall',exact=True).click()
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'")
        expect(page.locator('#contradiction-clerk-npc')).to_contain_text('BOUNDED ADVERSARY')
        expect(page.locator('#contradiction-clerk-npc')).to_contain_text('No published artifact is available to challenge yet')
        expect(page.locator('#contradiction-clerk-npc button')).to_have_count(0)
        assert page.locator('#creation-count').text_content()=='0', 'The bounded adversary must not invent a published target'
        assert page.locator('#xp-count').text_content()=='0', 'Opening the bounded adversary must not award XP'
        close_sheet(page)
        moonshot_objective=page.locator('[data-objective-id="founder-moonshot-proposal"]')
        expect(moonshot_objective).to_contain_text('OPEN')
        moonshot_objective.get_by_role('button',name='Go do this →',exact=True).click()
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
        page.locator('#places-button').click()
        page.get_by_role('button',name='Walk to moonshot proposal: Can this claim be falsified?',exact=True).click()
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
        page.screenshot(path=str(out/'institutional-locations.png'))
        assert not errors,errors
        return {'journey':'institutional-location-actions','passed':True,'locations':len(cases)+1,'moonshotProposals':1,'moonshotWorldObjects':1,'experimentReports':1,'creations':0,'xp':0,'errors':errors}
    finally:
        context.close()


def shared(browser,url,data,out):
    errors=[];presence_errors=[]
    owner=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    visitor=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    try:
        a,b=owner.new_page(),visitor.new_page()
        for page in [a,b]:
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('response',lambda response:presence_errors.append(response.status) if '/api/presence' in response.url and response.status>=400 else None)
            page.goto(url);page.locator('#start-shared').click()
            page.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#sheet .primary-button')).to_have_text('Explore another guide →')
        close_sheet(b)
        a.locator('#login-button').click();a.locator('#founder-key').fill(KEY);a.locator('#verify-founder').click()
        a.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Founder')")
        draft(a,'custom','PRIVATE_DRAFT_MARKER')
        close_sheet(a)
        snapshot=visitor.request.get(url+'api/state').json()
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
        snapshot=visitor.request.get(url+'api/state').json();creation=snapshot['world']['creations'][0];creation_id=creation['id']
        original=visitor.request.get(url+f'api/artifacts/{creation_id}?version=1').text()
        assert len(snapshot['institution']['kernel']['accepted'])==1
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to River of Receipts',exact=True).click()
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
        expect(frame.locator('#sources article')).to_have_count(1)
        frame.locator('#claim').fill('<b>Source note</b> — café 🌍')
        frame.locator('#source').fill('Cliffy · https://example.org/source')
        frame.locator('#uncertainty').fill('A note is not a verdict.')
        frame.locator('#add-source').click()
        expect(frame.locator('#status')).to_have_text('Observation added to this open artifact. Download to keep these notes.')
        expect(frame.locator('#sources article')).to_have_count(2)
        assert frame.locator('#sources b').count()==0
        with b.expect_download() as downloaded:frame.locator('#download').click()
        notes=json.loads(Path(downloaded.value.path()).read_text());assert notes['sources'][1]['claim']=='<b>Source note</b> — café 🌍'
        b.locator('#portal-close').click()
        visit(a,'The shared observatory')
        note='<script>not code</script> Witness — こんにちは 🌍'
        b.locator('#contribution-text').fill(note);b.locator('#contribute-button').click()
        a.locator('#creation-notes').get_by_text(note,exact=True).wait_for()
        assert a.locator('#creation-notes script').count()==0
        b.get_by_text('Report a problem or unsupported claim',exact=True).click()
        report_text='Preserve this report against version one.'
        drop={'remaining':True}
        def lose_report_response(route):
            try: payload=route.request.post_data_json
            except Exception: payload={}
            if drop['remaining'] and payload.get('type')=='report' and payload.get('text')==report_text:
                route.fetch()  # The service commits; simulate the response disappearing in transit.
                drop['remaining']=False
                route.abort()
                return
            route.continue_()
        b.route('**/api/action',lose_report_response)
        b.locator('#report-text').fill(report_text)
        b.locator('#report-button').click()
        expect(b.locator('#toast')).to_contain_text('unreachable')
        close_sheet(b);b.locator('#journal-button').click()
        b.locator('#retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        recovered=visitor.request.get(url+'api/state').json()
        assert sum(report['text']==report_text for report in recovered['world']['reports'])==1
        assert any(event.get('requestId') and event.get('actionResult',{}).get('id') for event in recovered['world']['events'] if event['type']=='report')
        b.unroute('**/api/action',lose_report_response)
        # Safe retry closes the Journal; reach the bounded adversary through the world Guild Hall.
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to Guild Hall',exact=True).click()
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'")
        expect(b.locator('#contradiction-clerk-npc')).to_contain_text('BOUNDED ADVERSARY')
        expect(b.locator('#contradiction-clerk-npc')).to_contain_text('No AI/provider call occurs')
        b.get_by_role('button',name='Challenge The shared observatory · v1 →',exact=True).click()
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='The shared observatory'")
        expect(b.locator('#contradiction-form')).to_be_visible()
        b.locator('#contradiction-claim').fill('The receipt proves the claim is true.')
        b.locator('#contradiction-source').fill('The preserved HTML bytes and the cited source page.')
        b.locator('#contradiction-falsifier').fill('A source that contradicts the claim or a failed reproduction.')
        b.locator('#contradiction-unknown').fill('Whether the source supports the wording; compare the exact passage.')
        b.locator('#contradiction-submit').click()
        b.locator('#creation-notes').get_by_text('CONTRADICTION CLERK · STRUCTURED CHALLENGE',exact=False).wait_for()
        challenge_snapshot=visitor.request.get(url+'api/state').json()
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
        b.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
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
        snapshot=visitor.request.get(url+'api/state').json()
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
        close_sheet(a);a.locator('#places-button').click()
        a.get_by_role('button',name='Walk to Moonshot Field',exact=True).click()
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
        challenge_state=visitor.request.get(url+'api/state').json()
        retained_challenges=[event for event in challenge_state['world']['events'] if event['type']=='experiment-challenged']
        assert len(retained_challenges)==1 and retained_challenges[0]['moonshotId']==moonshot_id
        assert retained_challenges[0]['evidenceCreationId']==creation_id and retained_challenges[0]['evidenceVersion']==2
        assert 'outcome' not in retained_challenges[0] and 'status' not in retained_challenges[0]
        assert challenge_state['world']['xp']==200, 'A retained challenge must not award XP'
        close_sheet(a)
        before={p['id']:p['x'] for p in owner.request.get(url+'api/state').json()['presence']}
        for page in [a,b]:
            # Actual movement exceeds the 1.5-second presence throttle; this is not an interaction readiness delay.
            close_sheet(page);page.locator('#world').focus();page.keyboard.down('ArrowRight');page.wait_for_timeout(2000);page.keyboard.up('ArrowRight')
        a.wait_for_function("async before=>{const r=await(await fetch('/api/state')).json();return r.presence.length===2&&r.presence.every(p=>Object.hasOwn(before,p.id)&&p.x>before[p.id]+1)}",arg=before)
        assert not presence_errors,presence_errors
        a.screenshot(path=str(out/'shared-desktop.png'));b.screenshot(path=str(out/'shared-phone.png'))
        assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')
        # A location or artifact panel may still be open after async shared-state refresh.
        # Dismiss it explicitly before exercising the authenticated logout transition.
        close_sheet(a)
        a.locator('#logout-button').click()
        a.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
        assert owner.request.get(url+'api/state').json()['viewer']['role']=='witness'
        assert owner.request.post(url+'api/action',data={'type':'draft','kind':'loom','title':'No','intent':'No'}).status==403
        assert not errors,errors
        return {'journey':'two-session-shared','passed':True,'errors':errors,'version':2,'kernelAccepted':2}
    finally:owner.close();visitor.close()


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
    page.locator('#journal-button').click()
    with page.expect_download() as saved:page.locator('#export-world').click()
    world=json.loads(Path(saved.value.path()).read_text())
    assert len(world['creations'])==3 and world['xp']==300
    page.locator('#import-world').set_input_files({'name':'world.json','mimeType':'application/json','buffer':json.dumps(world).encode()})
    page.wait_for_function("()=>document.querySelector('#sheet').hidden")
    page.reload(wait_until='networkidle');page.locator('#start-private').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent==='3'")
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(out/f'{label}-world.png'))
    assert not errors,errors
    return {'journey':label,'passed':True,'artifacts':3,'checks':6,'errors':errors}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass


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
                    for label,viewport,mobile in [('desktop',{'width':1440,'height':1000},False),('phone',{'width':390,'height':844},True)]:
                        context=browser.new_context(viewport=viewport,is_mobile=mobile,has_touch=mobile,reduced_motion='reduce' if mobile else 'no-preference',accept_downloads=True)
                        page=context.new_page()
                        try:record(basic(page,url,out,label))
                        except Exception:
                            page.screenshot(path=str(out/f'failed-{label}.png'));raise
                        finally:context.close()
                    record(institutional_locations(browser,url,out))
                    record(shared(browser,url,data,out))
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
                        page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
                        try:
                            record(basic(page,(ROOT/'dist/play.html').as_uri(),out,'standalone-file'))
                            assert not [u for u in requests if u.startswith(('http:','https:'))], 'Standalone fetched network content'
                        except Exception as error:
                            if 'ERR_BLOCKED_BY_ADMINISTRATOR' not in str(error):raise
                            record({'journey':'standalone-file','status':'blocked','reason':'Managed Chromium administrator policy blocks file navigation.'})
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
                    # Reopen actual private store after terminating all HTTP streams.
                    stop_server(process);process,url=launch_server(data)
                    fresh=browser.new_context();restored=fresh.request.get(url+'api/state').json();fresh.close()
                    assert restored['viewer']['role']=='witness' and restored['world']['creations'][0]['version']==2
                    assert len(restored['world']['contributions'])==1 and len(restored['world']['reports'])==2
                    assert all(report['version']==1 for report in restored['world']['reports'])
                    structured=[report for report in restored['world']['reports'] if report.get('text','').startswith('CONTRADICTION CLERK · STRUCTURED CHALLENGE')]
                    assert len(structured)==1 and 'REPORT ONLY — NOT A VERDICT' in structured[0]['text']
                    record({'journey':'shared-restart','passed':True,'retainedVersion':2})
                finally:browser.close()
        finally:stop_server(process)
    (out/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))


if __name__=='__main__':main()
