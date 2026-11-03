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
    page.goto(url,wait_until='networkidle')
    page.locator('#start-private').click()
    page.locator('#world').wait_for(state='visible')
    expect(page.locator('#world')).to_have_attribute('data-world-renderer', 'pixel-v1')
    page.wait_for_function("()=>document.querySelector('#mode-label').textContent.toLowerCase().includes('private')")
    character=page.locator('#character-button')
    expect(character).to_be_visible()
    expect(character).to_have_attribute('aria-label',re.compile('level 1',re.I))
    character.click()
    expect(page.locator('#sheet-title')).to_have_text('Character & field record')
    expect(page.locator('#sheet')).to_contain_text('Level 1')
    expect(page.locator('#sheet')).to_contain_text('Questkeeper')
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
    page.locator('#portal-close').click();page.locator('#publish-button').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('3')")
    expect(page.locator('#xp-count')).to_have_text('300')
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
    expect(page.locator('#xp-count')).to_have_text('300')
    close_sheet(page)
    page.locator('#places-button').click()
    page.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
    page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
    expect(page.locator('#sheet')).to_contain_text('CONTRADICTION CLERK · STRUCTURED CHALLENGE')
    expect(page.locator('#sheet')).to_contain_text('REPORT ONLY — NOT A VERDICT')
    expect(page.locator('#xp-count')).to_have_text('300')
    target_select=page.locator('[data-source-observation-import-target]')
    target_value=target_select.evaluate("el=>Array.from(el.options).find(option=>option.value)?.value")
    assert target_value, 'Evidence Archive did not offer the retained Source Observatory version'
    notes={
      'schema':'ngl.source-observatory.v2',
      'assurance':{'sourceRetrieval':'NOT_PERFORMED','independentVerification':'NOT_PERFORMED','modelAssertions':'LEADS_ONLY','execution':'NOT_EXECUTED'},
      'observations':[{'claim':'The model says the bridge is open.','sourceKind':'model-assertion','source':'Model output only; no source retrieved.','falsifier':'A direct inspection finds it closed.','uncertainty':'No independent observation.','nextTest':'Inspect the bridge.'}]
    }
    target_select.select_option(target_value)
    page.locator('[data-source-observation-import-file]').set_input_files({'name':'source-observations.json','mimeType':'application/json','buffer':json.dumps(notes).encode('utf-8')})
    expect(page.locator('[data-source-observation-import-confirm]')).to_be_enabled()
    page.locator('[data-source-observation-import-confirm]').click()
    expect(page.locator('[data-source-observation-card]')).to_have_count(1)
    expect(page.locator('#sheet')).to_contain_text('Model assertions are leads only, not evidence.')
    expect(page.locator('#xp-count')).to_have_text('300')
    # Re-importing the same actor/version/note is idempotent and adds no second world event.
    target_select=page.locator('[data-source-observation-import-target]')
    target_value=target_select.evaluate("el=>Array.from(el.options).find(option=>option.value)?.value")
    target_select.select_option(target_value)
    page.locator('[data-source-observation-import-file]').set_input_files({'name':'source-observations.json','mimeType':'application/json','buffer':json.dumps(notes).encode('utf-8')})
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
    assert not errors,errors
    return {'journey':label,'passed':True,'errors':errors}


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
        proposal_objective=page.locator('[data-objective-id="founder-moonshot-proposal"]')
        proposal_objective.locator('details.quest-evidence summary').click()
        proposal_link=proposal_objective.get_by_role('button',name='Inspect moonshot proposal →',exact=True)
        expect(proposal_link).to_be_visible()
        proposal_link.click()
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Moonshot Field' && document.querySelector('.moonshot-card.is-selected')?.textContent.includes('Can this claim be falsified?')")
        assert page.locator('.moonshot-card.is-selected').evaluate('(element)=>element===document.activeElement'), 'Quest evidence should navigate to and focus the exact retained proposal'
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
        close_sheet(page)
        page.locator('#places-button').click()
        page.get_by_role('button',name='Walk to Guild Hall',exact=True).click()
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'")
        for role in ('archivist','adversary','synthesizer','tutor'):
            expect(page.locator(f'[data-collaborator-role="{role}"]')).to_be_visible()
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
        page.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
        page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(page.locator('#sheet')).to_contain_text('BOUNDED COLLABORATOR RESPONSES')
        expect(page.locator('#sheet')).to_contain_text('STRUCTURE VALID · HUMAN REVIEW ONLY')
        page.locator('details.collaborator-response summary').click()
        archived_field=page.locator('textarea[aria-label="Archived collaborator response"]')
        expect(archived_field).to_have_count(1)
        assert archived_field.input_value()==valid_response_text
        close_sheet(page)
        experiment_objective=page.locator('[data-objective-id="founder-experiment-report"]')
        experiment_objective.locator('details.quest-evidence summary').click()
        attempt_link=experiment_objective.get_by_role('button',name='Inspect attempt →',exact=True)
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
        evidence_objective.get_by_role('button',name='Go do this →',exact=True).click()
        page.wait_for_function("()=>{const sheet=document.querySelector('#sheet');return sheet&&!sheet.hidden&&sheet.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&sheet.querySelector('[data-research-activity-id]')?.textContent.includes('The attempt contradicted the prediction.')}")
        activity_record=page.locator('[data-research-activity-id]').filter(has_text='The attempt contradicted the prediction.')
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
        page.wait_for_function("()=>{const sheet=document.querySelector('#sheet');return sheet&&!sheet.hidden&&sheet.querySelector('#sheet-title')?.textContent==='Moonshot Field'&&sheet.querySelector('[data-research-activity-id]')?.textContent.includes('The attempt contradicted the prediction.')}")
        activity_record=page.locator('[data-research-activity-id]').filter(has_text='The attempt contradicted the prediction.')
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
        return {'journey':'institutional-location-actions','passed':True,'locations':len(cases)+1,'moonshotProposals':1,'moonshotWorldObjects':1,'experimentReports':2,'researchActivityObjects':2,'creations':1,'xp':100,'errors':errors}
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
        expect(frame.locator('#observations article')).to_have_count(0)
        expect(frame.locator('body')).to_contain_text('Notes remain in this open artifact until downloaded')
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
        observation_objective=b.locator('[data-objective-id="witness-source-observation"]')
        expect(observation_objective).to_contain_text('OPEN')
        observation_objective.get_by_role('button',name='Go do this →',exact=True).click()
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='The shared observatory'")
        expect(b.locator('#source-observation-open')).to_be_visible()
        before_observation=visitor.request.get(url+'api/state').json()
        before_observation_revision=before_observation['world']['revision']
        witness_id=before_observation['viewer']['id']
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
        b.locator('#source-observation-open').click()
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
        not_committed=visitor.request.get(url+'api/state').json()
        assert not any(event['type']=='source-observation-recorded' for event in not_committed['world']['events']), 'A request aborted before server receipt must not create a canonical event'
        assert not_committed['world']['revision']==before_observation_revision
        assert not_committed['world']['xp']==before_observation['world']['xp']==100
        b.unroute('**/api/action',disconnect_source_observation)
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · RECORD-SOURCE-OBSERVATION')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        assert not b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'A successful exact retry must clear the pending receipt'
        first_recovery=visitor.request.get(url+'api/state').json()
        first_observations=[event for event in first_recovery['world']['events'] if event['type']=='source-observation-recorded']
        assert len(first_observations)==1 and first_observations[0]['claim']==offline_claim
        assert first_observations[0]['actor']['id']==witness_id and first_observations[0]['actor']['role']=='witness'
        assert first_recovery['world']['revision']==before_observation_revision+1
        assert first_recovery['world']['xp']==before_observation['world']['xp']==100
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
        committed_before_retry=visitor.request.get(url+'api/state').json()
        committed_events=[event for event in committed_before_retry['world']['events'] if event['type']=='source-observation-recorded']
        assert len(committed_events)==2 and committed_events[-1]['claim']==source_claim, 'The independent state read must observe the second committed note before Relay retry'
        assert committed_before_retry['world']['revision']==before_observation_revision+2
        assert committed_before_retry['world']['xp']==before_observation['world']['xp']==100
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · RECORD-SOURCE-OBSERVATION')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        assert not b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'A successful exact retry must clear the pending receipt'
        recovered_observation=visitor.request.get(url+'api/state').json()
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
        b.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(b.locator('[data-source-observation-card]')).to_have_count(2)
        expect(b.locator('#sheet')).to_contain_text('Model assertions are leads only, not evidence.')
        close_sheet(b)
        visit(b,'The shared observatory')
        visit(a,'The shared observatory')
        expect(a.locator('#source-observations')).to_contain_text(offline_claim)
        expect(a.locator('#source-observations')).to_contain_text(source_claim)
        before_challenge=visitor.request.get(url+'api/state').json()
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
        committed_challenge=visitor.request.get(url+'api/state').json()
        challenge_events=[event for event in committed_challenge['world']['events'] if event['type']=='source-observation-challenged']
        challenge_diagnostic={'expected':challenge_text,'events':challenge_events,'revision':committed_challenge['world']['revision'],'xp':committed_challenge['world']['xp'],'before_revision':before_challenge['world']['revision'],'pending':pending_challenge,'route':lost_challenge,'existing_request_ids':[event.get('requestId') for event in committed_challenge['world']['events'] if event.get('requestId')]}
        assert len(challenge_events)==1 and challenge_events[0].get('challengeText')==challenge_text, json.dumps(challenge_diagnostic,ensure_ascii=False)
        assert challenge_events[0]['actor']['id']=='damien' and challenge_events[0]['actor']['role']=='founder'
        assert committed_challenge['world']['revision']==before_challenge['world']['revision']+1
        assert committed_challenge['world']['xp']==before_challenge['world']['xp']==100
        a.unroute('**/api/action',lose_source_challenge_response)
        close_sheet(a);a.locator('#places-button').click()
        a.get_by_role('button',name='Walk to The Relay',exact=True).click()
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(a.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(a.locator('#relay-pending-action')).to_contain_text('Pending action · CHALLENGE-SOURCE-OBSERVATION')
        a.locator('#relay-retry-pending-shared-action').click()
        expect(a.locator('#sheet')).to_be_hidden()
        assert not a.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'Exact challenge retry must clear the pending receipt'
        after_challenge_retry=visitor.request.get(url+'api/state').json()
        assert len([event for event in after_challenge_retry['world']['events'] if event['type']=='source-observation-challenged'])==1
        assert after_challenge_retry['world']['revision']==committed_challenge['world']['revision'], 'Exact retry must not append a second challenge'
        assert after_challenge_retry['world']['xp']==before_challenge['world']['xp']==100
        # Exercise the Evidence Archive docket as a real world interaction.
        # The challenger can inspect the exact version but cannot see the author's response control.
        before_docket=visitor.request.get(url+'api/state').json()
        close_sheet(a);a.locator('#places-button').click()
        a.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
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
        after_register=visitor.request.get(url+'api/state').json()
        assert after_register['world']['revision']==before_docket['world']['revision'], 'Opening a read-only register entry must not append a world event'
        assert after_register['world']['xp']==before_docket['world']['xp'], 'Opening a read-only register entry must not award XP'
        close_sheet(a);a.locator('#places-button').click()
        a.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
        a.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        docket_selector='[data-source-observation-pending-challenge="'+challenge_events[0]["challengeId"]+'"]'
        docket_button=a.locator(docket_selector)
        expect(docket_button).to_have_count(1)
        a.screenshot(path=str(out/'source-observation-response-docket-pending.png'))
        docket_button.click()
        a.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='The shared observatory')
        expect(a.locator('#version-select')).to_have_value(str(source_observation['version']))
        expect(a.locator('[data-source-observation-response-details]')).to_have_count(0)
        after_docket=visitor.request.get(url+'api/state').json()
        assert after_docket['world']['revision']==before_docket['world']['revision'], 'Opening the read-only docket and exact version must not append a world event'
        assert after_docket['world']['xp']==before_docket['world']['xp'], 'Opening the read-only docket and exact version must not award XP'

        # The original Witness author can answer from the same docket without editing the note.
        visit(b,'The shared observatory')
        expect(b.locator('[data-source-observation-challenge]')).to_have_count(1)
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
        b.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='Evidence Archive'")
        expect(b.locator('#sheet')).to_contain_text('1 uniquely linked challenge(s) await an author response')
        author_docket_button=b.locator(docket_selector)
        expect(author_docket_button).to_have_count(1)
        author_docket_button.click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title')?.textContent===expected",arg='The shared observatory')
        expect(b.locator('#version-select')).to_have_value(str(source_observation['version']))
        expect(b.locator('[data-source-observation-response-details]')).to_have_count(1)
        response_text='The note is a lead only; source retrieval remains outstanding.'
        before_author_response=visitor.request.get(url+'api/state').json()
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
        committed_author_response=visitor.request.get(url+'api/state').json()
        author_response_events=[event for event in committed_author_response['world']['events'] if event['type']=='source-observation-challenge-responded']
        assert len(author_response_events)==1 and author_response_events[0]['responseText']==response_text
        assert author_response_events[0]['actor']['id']==witness_id and author_response_events[0]['actor']['role']=='witness'
        assert author_response_events[0]['observationId']==source_observation['observationId']
        assert author_response_events[0]['creationId']==source_observation['creationId'] and author_response_events[0]['version']==source_observation['version']
        assert committed_author_response['world']['revision']==before_author_response['world']['revision']+1
        assert committed_author_response['world']['xp']==before_author_response['world']['xp']==100
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · RESPOND-SOURCE-OBSERVATION-CHALLENGE')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        assert not b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')"), 'Exact author-response retry must clear the pending receipt'
        after_author_response_retry=visitor.request.get(url+'api/state').json()
        assert len([event for event in after_author_response_retry['world']['events'] if event['type']=='source-observation-challenge-responded'])==1
        assert after_author_response_retry['world']['revision']==committed_author_response['world']['revision'], 'Exact author-response retry must not append a second response'
        assert after_author_response_retry['world']['xp']==before_author_response['world']['xp']==100
        b.unroute('**/api/action',lose_source_author_response)
        visit(b,'The shared observatory')
        expect(b.locator('#source-observations')).to_contain_text(response_text)
        expect(b.locator('[data-source-observation-response]')).to_have_count(1)
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
        docket_before_answered_view=visitor.request.get(url+'api/state').json()
        close_sheet(a);a.locator('#places-button').click()
        a.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
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
        docket_after_answered_view=visitor.request.get(url+'api/state').json()
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
        receipt=b.evaluate("localStorage.getItem('ngl.common-ground.pending-shared-action.v1')")
        assert receipt, 'A lost response must leave the exact retry receipt on this device'
        # A local receipt is not authority: a different actor must not be able to replay it.
        b.evaluate("""raw=>{const item=JSON.parse(raw);item.actorId='not-the-original-actor';localStorage.setItem('ngl.common-ground.pending-shared-action.v1',JSON.stringify(item))}""",receipt)
        close_sheet(b);b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN')
        expect(b.locator('#relay-pending-action')).to_contain_text('does not match the original actor')
        expect(b.locator('#relay-retry-pending-shared-action')).to_have_count(0)
        close_sheet(b)
        b.evaluate("(raw)=>localStorage.setItem('ngl.common-ground.pending-shared-action.v1',raw)",receipt)
        b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#relay-pending-action')).to_contain_text('Pending action · REPORT')
        b.locator('#relay-retry-pending-shared-action').click()
        expect(b.locator('#sheet')).to_be_hidden()
        expect(b.locator('#xp-count')).to_have_text('100')
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
        return {'journey':'two-session-shared','passed':True,'errors':errors,'version':2,'kernelAccepted':2,'sourceObservationResponseDocket':'pending → exact version → author-only response → answered Chronicle'}
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
