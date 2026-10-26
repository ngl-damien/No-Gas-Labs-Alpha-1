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
    page.keyboard.down('ArrowRight');page.wait_for_timeout(300);page.keyboard.up('ArrowRight')
    draft(page,'comic','The real comic lives here')
    page.locator('#preview-button').click()
    frame=page.frame_locator('#artifact-frame')
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
    frame.locator('#score').fill('café 🌍 🧶')
    frame.locator('#play').click()
    expect(frame.locator('#status')).to_have_text('Playing 8 Unicode notes.')
    assert frame.locator('#threads span').count()==8, 'Unicode mapping did not use codepoints'
    frame.locator('#stop').click()
    page.locator('#portal-close').click();page.locator('#publish-button').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('2')")
    expect(page.locator('[data-objective-id="founder-second-place"]')).to_contain_text('RECORDED')
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
        page.screenshot(path=str(out/'institutional-locations.png'))
        assert not errors,errors
        return {'journey':'institutional-location-actions','passed':True,'locations':len(cases),'creations':0,'xp':0,'errors':errors}
    finally:
        context.close()


def shared(browser,url,data,out):
    errors=[];presence_errors=[]
    owner=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    visitor=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
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
        # srcdoc inputs can appear before the inline artifact script has attached handlers.
        # Wait for its initial rendered receipt before exercising the form.
        expect(frame.locator('#sources article')).to_have_count(1)
        frame.locator('#claim').fill('<b>Source note</b> — café 🌍')
        frame.locator('#source').fill('Cliffy · https://example.org/source')
        frame.locator('#uncertainty').fill('A note is not a verdict.')
        frame.locator('#add-source').click()
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
        b.locator('#report-text').fill('Preserve this report against version one.')
        b.locator('#report-button').click()
        b.get_by_text('Ask the Contradiction Clerk to challenge this version',exact=True).click()
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
        a.locator('#repair-button').click();a.locator('#publish-button').wait_for()
        assert visitor.request.get(url+f'api/artifacts/{creation_id}').text()==original
        a.locator('#publish-button').click()
        b.wait_for_function("()=>document.querySelector('#xp-count').textContent==='200'")
        snapshot=visitor.request.get(url+'api/state').json()
        assert snapshot['world']['creations'][0]['version']==2 and len(snapshot['world']['methods'])==1
        assert len(snapshot['institution']['kernel']['accepted'])==2
        assert visitor.request.get(url+f'api/artifacts/{creation_id}?version=1').text()==original
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
                    assert len(restored['world']['contributions'])==1 and len(restored['world']['reports'])==1
                    record({'journey':'shared-restart','passed':True,'retainedVersion':2})
                finally:browser.close()
        finally:stop_server(process)
    (out/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))


if __name__=='__main__':main()
