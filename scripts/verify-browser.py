"""Actual Chromium acceptance against a disposable Node service and packaged offline file.

Requires Python Playwright plus Chromium for development only. No provider keys or public posts.
"""
import argparse
import os
import json
import hashlib
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
        for role,name,location in [
            ('archivist','Hostile Archivist','Evidence Archive'),
            ('adversary','Adversary','Evidence Archive'),
            ('synthesizer','Synthesis Clerk','Guild Hall'),
            ('tutor','Polymath Tutor','Polymath Academy')
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
        page.locator('details.collaborator-response summary').filter(has_text='Inspect exact pasted response').click()
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
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
        b.wait_for_function("(expected)=>document.querySelector('#sheet-title').textContent===expected",arg='Carry the question.')
        expect(b.locator('#sheet .primary-button')).to_have_text('Explore another guide →')
        close_sheet(b)

        # Before any Observatory publication exists, a Witness can inspect the
        # empty research room but cannot create or publish its first target.
        b.locator('#places-button').click()
        b.get_by_role('button',name='Walk to Source Observatory',exact=True).click()
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
        a.get_by_role('button',name='Walk to Source Observatory',exact=True).click()
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
        a.get_by_role('button',name='Walk to Founder Gate',exact=True).click()
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
        b.get_by_role('button',name='Walk to Founder Gate',exact=True).click()
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
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        b.get_by_role('button',name='Walk to Source Observatory',exact=True).click()
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
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        b.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
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
        a.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        after_register=read_state(visitor)
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
        after_docket=read_state(visitor)
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
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        b.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        b.get_by_role('button',name='Walk to Guild Hall',exact=True).click()
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
        challenge_state=read_state(visitor)
        retained_challenges=[event for event in challenge_state['world']['events'] if event['type']=='experiment-challenged']
        assert len(retained_challenges)==1 and retained_challenges[0]['moonshotId']==moonshot_id
        assert retained_challenges[0]['evidenceCreationId']==creation_id and retained_challenges[0]['evidenceVersion']==2
        assert 'outcome' not in retained_challenges[0] and 'status' not in retained_challenges[0]
        pre_guild_challenge=a.locator('[data-objective-id="founder-challenge-experiment-report"]')
        expect(pre_guild_challenge).to_contain_text('RECORDED')
        expect(pre_guild_challenge).to_contain_text('Challenge another actor’s experiment report')
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
        a.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        a.get_by_role('button',name='Walk to Evidence Archive',exact=True).click()
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
            records=payload['inputRecords']
            if role=='archivist':
                return {
                    'eventChainFindings':['The proposal precedes the linked experiment records in this supplied snapshot.'],
                    'claims':['The retained report records a self-reported failed attempt.'],
                    'linkageIssues':['The packet contains retained references, not independently retrieved source bytes.'],
                    'unknowns':['External source retrieval and independent verification have not been performed.'],
                    'nextChecks':['Retrieve the cited source independently and compare the exact bytes.']
                }
            if role=='synthesizer':
                report=next((record for record in records if record.get('type')=='experiment-reported'),None)
                challenge=next((record for record in records if record.get('type')=='experiment-challenged'),None)
                assert report and challenge, 'Synthesis packet must disclose the retained report and dissent it summarizes'
                dissent_ids=[record['eventId'] for record in records if record.get('type')=='experiment-challenged']
                return {
                    'scope':{
                        'moonshotId':payload['targetMoonshotId'],
                        'includedEventIds':payload['inputRefs'],
                        'omittedEventIds':payload['omittedEventIds']
                    },
                    'recordedSupport':[{
                        'sourceEventIds':[report['eventId']],
                        'statement':'The supplied packet retains a self-reported experiment attempt; this establishes that a report was recorded, not that its claim is true.'
                    }],
                    'contradictions':[{
                        'sourceEventIds':[report['eventId'],challenge['eventId']],
                        'statement':'The report records a failed attempt while the challenge identifies a missing control; this retained slice cannot determine whether the result reflects the hypothesis or the method.'
                    }],
                    'dissentPreserved':dissent_ids,
                    'unknowns':['No independent measurement or source retrieval is present in this packet.'],
                    'nextDiscriminatingExperiment':{
                        'procedure':'Repeat the procedure with the missing measurement control specified and preserve the raw observations.',
                        'outcome':'Compare the controlled result with the original self-reported outcome.'
                    }
                }
            if role=='tutor':
                return {
                    'concepts':['falsifiability','measurement control','observation versus inference'],
                    'prerequisites':['distinguish a reported outcome from an independently observed result'],
                    'explanation':'A falsifier states what observation would count against a hypothesis. A control helps separate the effect under study from other explanations. A retained report is a record of what an actor said happened, not proof that the result was independently observed.',
                    'questions':['What result would count against the hypothesis?','Which measurement control is missing from the report?'],
                    'answerKey':['A repeatable observation matching the stated falsifier.','A control condition that isolates the variable being tested.'],
                    'whatRemainsUnproven':['Whether the hypothesis survives a controlled replication.','Whether the reported result can be independently reproduced.']
                }
            raise AssertionError('Unexpected Council role: '+role)

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
            response_text=json.dumps(make_council_response(role,payload),ensure_ascii=False)
            packet.locator('details.collaborator-response summary').click()
            response_field=packet.locator('textarea[aria-label$="response JSON"]')
            response_field.fill(response_text)
            packet.get_by_role('button',name='Validate response for review',exact=True).click()
            expect(packet.locator(f'[data-collaborator-response-status="{role}"]')).to_contain_text('STRUCTURE VALID')
            before=read_state(visitor)
            assert before['viewer']['role']=='witness'
            before_revision=before['world']['revision']
            before_xp=before['world']['xp']
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
            if role=='tutor':
                close_sheet(page)
                page.locator('#places-button').click()
                page.get_by_role('button',name='Walk to Guild Hall',exact=True).click()
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
            page.get_by_role('button',name='Walk to The Commons at TownSquare',exact=True).click()
            page.wait_for_timeout(8000)
            for _ in range(24):
                if page.locator('#sheet').is_visible():
                    if page.locator('#sheet-title').text_content()=='The Commons at TownSquare':
                        return
                    close_sheet(page)
                page.locator('#interact-button').click()
                try:
                    page.wait_for_function("()=>document.querySelector('#sheet-title')?.textContent==='The Commons at TownSquare'&&!document.querySelector('#sheet').hidden",timeout=500)
                    return
                except Exception:
                    if page.locator('#sheet').is_visible():
                        close_sheet(page)
                    page.wait_for_timeout(350)
            raise AssertionError('The player could not reach and interact with The Commons at TownSquare')

        open_commons(a)
        before_commons=read_state(owner)
        assert before_commons['viewer']['role']=='founder'
        before_commons_revision=before_commons['world']['revision']
        before_commons_xp=before_commons['world']['xp']
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
        a.get_by_role('button',name='Walk to The Relay',exact=True).click()
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
        b.locator(f'#commons-report-details-{commons_message_id}').fill('A human should review the public text, not erase the original.')
        b.locator(f'[data-commons-report="{commons_message_id}"]').click()
        expect(b.locator('#toast')).to_contain_text('Private report retained for human review')
        report_state=read_state(owner)
        assert len([event for event in report_state['world']['events'] if event['type']=='message-reported'])==1

        open_commons(a)
        founder_card=a.locator(f'[data-commons-message-id="{commons_message_id}"]')
        expect(founder_card.locator(f'[data-commons-hide="{commons_message_id}"]')).to_have_count(1)
        expect(a.locator('#commons-pending-reports')).to_contain_text('A human should review the public text')
        a.locator(f'#commons-moderation-reason-{commons_message_id}').select_option('privacy')
        founder_card.locator(f'[data-commons-hide="{commons_message_id}"]').click()
        expect(a.locator('#toast')).to_contain_text('Message hidden')
        hidden_for_witness=read_state(visitor)
        hidden_post=next(event for event in hidden_for_witness['world']['events'] if event['type']=='message-posted' and event['messageId']==commons_message_id)
        assert hidden_post['text']=='[Message hidden by human moderation.]'
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
        assert restored_for_witness['world']['revision']==before_commons_revision+5
        assert restored_for_witness['world']['xp']==before_commons_xp
        expect(a.locator('[data-objective-id="founder-commons-message"]')).to_contain_text('RECORDED')
        expect(b.locator('[data-objective-id="witness-commons-message"]')).to_contain_text('RECORDED')
        close_sheet(a);a.locator('#character-button').click()
        expect(a.locator('#sheet')).to_contain_text('Speaker')
        expect(a.locator('#sheet')).to_contain_text('1 recorded')
        close_sheet(a);close_sheet(b)

        def open_guild_hall(page):
            close_sheet(page)
            page.locator('#places-button').click()
            page.get_by_role('button',name='Walk to Guild Hall',exact=True).click()
            # WorldView opens an institution automatically when its route reaches
            # the destination. Repeatedly pressing Interact while still walking
            # can cancel or redirect that route, so wait for the actual arrival.
            try:
                page.wait_for_function(
                    "()=>document.querySelector('#sheet-title')?.textContent==='Guild Hall'&&!document.querySelector('#sheet').hidden",
                    timeout=30000
                )
            except Exception as error:
                page.screenshot(path=str(out/'failed-guild-hall-arrival.png'))
                title=page.locator('#sheet-title').text_content()
                raise AssertionError(
                    f'The player could not reach Guild Hall within 30 seconds; current sheet title={title!r}'
                ) from error

        # Both actors must arrive before measuring guild-only revision changes;
        # moving the Witness from the Observatory can itself record exploration.
        open_guild_hall(a)
        open_guild_hall(b)
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

        # The Witness joins from the Founder avatar in the shared world, not
        # from a detached roster-only control. Inspection itself is read-only.
        close_sheet(b)
        expect(b.locator('#world')).to_have_attribute('data-nearby-player-role','founder')
        interact_label=b.locator('#interact-button').get_attribute('aria-label') or ''
        assert 'Inspect nearby player' in interact_label, interact_label
        before_player_inspection=read_state(visitor)
        b.locator('#interact-button').click()
        profile=b.locator('[data-player-profile]')
        expect(profile).to_be_visible()
        expect(profile).to_contain_text('Field Researchers')
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
        b.get_by_role('button',name='Walk to Forge',exact=True).click()
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
        expect(b.locator('#toast')).to_contain_text('Source observation retained in the world')
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
            'sourceObservationHandoff':handoff_recovery
        }
        result={'journey':'two-session-shared','passed':True,'errors':errors,'version':2,'kernelAccepted':2,'sourceObservatoryEmptyState':'Witness read-only wait; Founder-only Observatory recipe entry; both inspections preserve revision and XP','sourceObservationResponseDocket':'pending → exact version → author-only response → answered Chronicle','guildNpcCollaboratorRelay':'Adversary NPC → source-bound packet → response committed → exact Relay retry → one retained response → next-role quest','guildCouncilCoverage':'four role-specific retained attempts → collapsed source-bound Council dossier → Character Council skill 4; no XP or state mutation','commonsSocial':'TownSquare post → exact Relay retry → device-local mute/unmute → Witness private report → Founder hide/restore → retained history; no XP','commonsFieldSatchel':'Founder message → actor-scoped retained satchel item → TownSquare return action; Witness sees no foreign item; no XP or world mutation','playerGuildMembership':'Founder creates → Witness joins → occupied guild cannot be disbanded → Witness leaves → Founder closes; four retained events, no XP','playerGuildLeadership':'offer → decline → cancel → accept; both browser clients observe the retained decline event','sourceObservationHandoff':'downloaded notebook → fresh artifact preview/explicit restore → host review → actor/version-bound Chronicle event → exact replay no-op; no XP','decisionGate':'FOUNDER_NOT_ENROLLED; Founder and Witness readiness visible; Witness evaluation bytes and disposition controls withheld; no world revision or XP change','relayAutoRecovery':'same actor and exact request ID → online replay + shared re-entry replay → one retained report/event/revision; no XP','forgeInventory':'Witness Relay discovery → Forge item → 320px two-session offer/cancel/accept → current owner changes only after recipient acceptance; original creator/source persist; no XP','stateReadRetries':state_read_retries['count']}
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
        page.get_by_role('button',name='Walk to Quest Board',exact=True).click()
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
        page.get_by_role('button',name='Walk to Quest Board',exact=True).click()
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
        page.get_by_role('button',name='Walk to Quest Board',exact=True).click()
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
        page.get_by_role('button',name='Walk to Quest Board',exact=True).click()
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
                    for width in [320,390]:record(forge_inventory_mobile(browser,url,out,width))
                    shared_result,shared_position_recovery=shared(browser,url,data,out)
                    record(shared_result)
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
                        assert len(restored['world']['contributions'])==1 and len(restored['world']['reports'])==3
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
