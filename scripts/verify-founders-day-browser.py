"""Actual Chromium: portable ceremony and local blocked Gate. No operational activation."""
import argparse, functools, hashlib, http.server, json, select, subprocess, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
KEY='fake-founders-day-browser-key-not-a-secret'
SERVER="""import{createGameServer}from'./game/server.mjs';import{loadQualificationProposal}from'./src/institution/founder-gate.mjs';
const founderGate=await loadQualificationProposal({root:process.cwd()});
const server=await createGameServer({dataDir:process.argv[1],founderKey:'fake-founders-day-browser-key-not-a-secret',founderGate});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.once('SIGTERM',async()=>{await server.closeGame()});"""
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--out',default='/tmp/founders-day-browser');args=parser.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
 class Quiet(http.server.SimpleHTTPRequestHandler):
  def log_message(self,*args):pass
 portable=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'dist')))
 thread=threading.Thread(target=portable.serve_forever,daemon=True);thread.start();journeys=[];errors=[]
 with tempfile.TemporaryDirectory(prefix='ngl-founders-day-browser-')as directory:
  child=subprocess.Popen(['node','--input-type=module','-e',SERVER,directory],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   assert select.select([child.stdout],[],[],15)[0],'Service readiness timeout'
   line=child.stdout.readline();assert line,child.stderr.read();origin=f'http://127.0.0.1:{json.loads(line)["port"]}'
   with sync_playwright()as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for width in [390,1440]:
     page=browser.new_page(viewport={'width':width,'height':900});page.on('pageerror',lambda error:errors.append(str(error)));requests=[];page.on('request',lambda request:requests.append(request.url))
     await_url=f'http://127.0.0.1:{portable.server_port}/founders-day.html';page.goto(await_url);expect(page.locator('#connection-state')).to_have_text('PREPARED PREVIEW');expect(page.locator('#login-form')).to_be_hidden();assert page.locator('#activate-button').is_disabled();assert all(page.locator('[data-action="'+action+'"]').is_disabled() for action in ['APPROVE','DEFER','REJECT']);assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
     with page.expect_download()as downloaded:page.locator('#download-record').click()
     record=json.loads(Path(downloaded.value.path()).read_text());assert record['decision']is None and record['ceremony']['status']=='PREPARED' and record['ceremony']['location']['name']=='Carter Lake, Iowa';assert record['ceremony']['performanceAttested']is False
     assert requests==[await_url],requests;page.screenshot(path=str(out/f'ceremony-{width}.png'),full_page=True);journeys.append({'id':f'portable-{width}','passed':True,'networkRequests':len(requests),'recordStatus':'PREPARED'});page.close()
    context=browser.new_context(viewport={'width':390,'height':900});page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));page.goto(origin+'/founder-gate');expect(page.locator('#connection-state')).to_have_text('WITNESS VIEW');expect(page.locator('#login-form')).to_be_hidden();assert all(page.locator('[data-action="'+action+'"]').is_disabled() for action in ['APPROVE','DEFER','REJECT']);state=context.request.get(origin+'/api/founder-gate').json();assert state['decision']is None and state['ready']is False;assert 'evaluation'not in state['proposal'];journeys.append({'id':'http-clock-not-started','passed':True})
    login=context.request.post(origin+'/api/login',data={'key':KEY});assert login.status==200;page.reload();expect(page.locator('#connection-state')).to_have_text('FOUNDER CONNECTED');expect(page.locator('#private-evidence')).to_be_visible();assert page.locator('#activate-button').is_disabled();assert all(page.locator('[data-action="'+action+'"]').is_disabled() for action in ['APPROVE','DEFER','REJECT']);assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(out/'founder-blocked-phone.png'),full_page=True)
    page.locator('#logout-button').click();expect(page.locator('#connection-state')).to_have_text('WITNESS VIEW');expect(page.locator('#private-evidence')).to_be_hidden();expect(page.locator('#evaluation-bytes')).to_have_text('');journeys.append({'id':'private-review-logout-clear','passed':True});context.close();browser.close()
   assert not errors,errors
   result={'schema':'ngl.founders-day-browser.v1','passed':True,'journeys':journeys,'errors':errors,'portableSHA256':hashlib.sha256((ROOT/'dist/founders-day.html').read_bytes()).hexdigest(),'limits':'Real Chromium portable preview and local HTTP refusal/redaction; native verified-TLS activation is checked separately by Node tests. No public Gate or ceremony performance established.'};(out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':True,'journeys':len(journeys)}))
  finally:
   child.terminate();child.wait(timeout=10);portable.shutdown();portable.server_close();thread.join()
if __name__=='__main__':main()
