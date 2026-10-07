#!/usr/bin/env python3
import hashlib,json,urllib.request
from datetime import datetime,timezone
from pathlib import Path
root=Path(__file__).resolve().parents[1]; state_path=root/'contact/state.json'; ledger_path=root/'contact/ledger.jsonl'
state=json.loads(state_path.read_text())
if not state.get('enabled'): raise SystemExit('CONTACT disabled by founder')
try:
    req=urllib.request.Request('https://api.github.com/repos/No-Gas-Labs-Official/ngl001-def4us28',headers={'User-Agent':'NGL-CONTACT-001'})
    with urllib.request.urlopen(req,timeout=20) as response:
        data=json.loads(response.read().decode()); observation={'ok':True,'status':response.status,'full_name':data.get('full_name'),'default_branch':data.get('default_branch'),'pushed_at':data.get('pushed_at')}
except Exception as exc:
    observation={'ok':False,'error_type':type(exc).__name__,'error':str(exc)[:300]}
event={'schema':'ngl.contact.event.v1','type':'EXTERNAL_OBSERVATION','actor':'contact-runtime','authority':'observation','claim':'GitHub repository API observation','evidence':observation,'previous_hash':state.get('last_event_hash'),'timestamp':datetime.now(timezone.utc).isoformat()}
canonical=json.dumps(event,sort_keys=True,separators=(',',':')); event['event_hash']=hashlib.sha256(canonical.encode()).hexdigest()
with ledger_path.open('a') as ledger: ledger.write(json.dumps(event,sort_keys=True)+'\n')
state['run_count']=int(state.get('run_count',0))+1; state['last_event_hash']=event['event_hash']; state['last_observation']=event
state['phase']='OBSERVED' if observation['ok'] else 'OBSERVATION_FAILED'; state['next_transition']='AWAIT_FOUNDER_OR_NEXT_STEPWIRE' if observation['ok'] else 'RETRY_OBSERVATION'
state_path.write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
print(json.dumps({'event_hash':event['event_hash'],'observation':observation,'next_transition':state['next_transition']},sort_keys=True))
