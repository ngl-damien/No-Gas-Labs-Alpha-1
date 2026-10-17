"""Actual Chromium acceptance against a disposable Node service and packaged offline file.

Requires Python Playwright plus Chromium for development only. No provider keys or public posts.
"""
import argparse
import json
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
    if page.locator('#sheet').is_visible(): page.locator('#sheet-close').click()


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
    page.keyboard.down('ArrowRight');page.wait_for_timeout(300);page.keyboard.up('ArrowRight')
    draft(page,'comic','The real comic lives here')
    page.locator('#preview-button').click()
    frame=page.frame_locator('#artifact-frame')
    frame.locator('img').first.wait_for()
    assert frame.locator('img').first.evaluate('(img)=>img.decode().then(()=>img.naturalWidth>0)'), 'Original comic did not load'
    page.locator('#portal-close').click();page.locator('#publish-button').click()
    page.wait_for_function("()=>document.querySelector('#creation-count').textContent.includes('1')")
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


def shared(browser,url,data,out):
    errors=[]
    owner=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    visitor=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
    try:
        a,b=owner.new_page(),visitor.new_page()
        for page in [a,b]:
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(url);page.locator('#start-shared').click()
            page.wait_for_function("()=>document.querySelector('#mode-label').textContent.includes('Witness')")
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
        visit(b,'The shared observatory');b.locator('#enter-creation').click()
        frame=b.frame_locator('#artifact-frame')
        frame.locator('#claim').fill('<b>Source note</b> — café 🌍')
        frame.locator('#source').fill('Cliffy · https://example.org/source')
        frame.locator('#uncertainty').fill('A note is not a verdict.')
        frame.locator('#add-source').click()
        assert frame.locator('#sources article').count()==2
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
        a.locator('#repair-button').click();a.locator('#publish-button').wait_for()
        assert visitor.request.get(url+f'api/artifacts/{creation_id}').text()==original
        a.locator('#publish-button').click()
        b.wait_for_function("()=>document.querySelector('#xp-count').textContent==='200'")
        snapshot=visitor.request.get(url+'api/state').json()
        assert snapshot['world']['creations'][0]['version']==2 and len(snapshot['world']['methods'])==1
        assert len(snapshot['institution']['kernel']['accepted'])==2
        assert visitor.request.get(url+f'api/artifacts/{creation_id}?version=1').text()==original
        for page in [a,b]:
            close_sheet(page);page.locator('#world').focus();page.keyboard.down('ArrowRight');page.wait_for_timeout(350);page.keyboard.up('ArrowRight')
        a.wait_for_function("async()=>{const r=await(await fetch('/api/state')).json();return r.presence.length===2}")
        a.screenshot(path=str(out/'shared-desktop.png'));b.screenshot(path=str(out/'shared-phone.png'))
        assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')
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
    with tempfile.TemporaryDirectory(prefix='ngl-browser-service-') as data:
        process,url=launch_server(data)
        try:
            with sync_playwright() as playwright:
                browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                try:
                    for label,viewport,mobile in [('desktop',{'width':1440,'height':1000},False),('phone',{'width':390,'height':844},True)]:
                        context=browser.new_context(viewport=viewport,is_mobile=mobile,has_touch=mobile,reduced_motion='reduce' if mobile else 'no-preference',accept_downloads=True)
                        page=context.new_page()
                        try:results.append(basic(page,url,out,label))
                        except Exception:
                            page.screenshot(path=str(out/f'failed-{label}.png'));raise
                        finally:context.close()
                    results.append(shared(browser,url,data,out))
                    for width in [320,412]:
                        context=browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce',accept_downloads=True)
                        try:results.append(launchpad(context.new_page(),url,out,f'one-button-{width}'))
                        finally:context.close()
                    if args.standalone:
                        context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
                        page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
                        try:
                            results.append(basic(page,(ROOT/'dist/play.html').as_uri(),out,'standalone-file'))
                            assert not [u for u in requests if u.startswith(('http:','https:'))], 'Standalone fetched network content'
                        except Exception as error:
                            if 'ERR_BLOCKED_BY_ADMINISTRATOR' not in str(error):raise
                            results.append({'journey':'standalone-file','status':'blocked','reason':'Managed Chromium administrator policy blocks file navigation.'})
                        finally:context.close()
                        # Serve the exact packaged bytes with no added CSP; this is distinct from a file:// check.
                        static=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT/'dist')))
                        threading.Thread(target=static.serve_forever,daemon=True).start()
                        packaged=f'http://127.0.0.1:{static.server_address[1]}/play.html'
                        try:
                            context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
                            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
                            results.append(launchpad(page,packaged,out,'standalone-exact-bytes'))
                            assert all(u==packaged or u.startswith(('data:','blob:')) for u in requests),requests
                            context.close()
                        finally:static.shutdown();static.server_close()
                    # Reopen actual private store after terminating all HTTP streams.
                    stop_server(process);process,url=launch_server(data)
                    fresh=browser.new_context();restored=fresh.request.get(url+'api/state').json();fresh.close()
                    assert restored['viewer']['role']=='witness' and restored['world']['creations'][0]['version']==2
                    assert len(restored['world']['contributions'])==1 and len(restored['world']['reports'])==1
                    results.append({'journey':'shared-restart','passed':True,'retainedVersion':2})
                finally:browser.close()
        finally:stop_server(process)
    (out/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))


if __name__=='__main__':main()
