#!/usr/bin/env node
import { createCourier, signEnvelope, canonicalJSON, payloadDigest } from '../src/institution/courier.mjs';
import { generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, open, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const command=process.argv[2] || 'help';
function options(args) {
  const result={};
  for(let i=0;i<args.length;i+=2) {
    if(!args[i]?.startsWith('--') || !args[i+1] || args[i+1].startsWith('--'))throw new Error('Options require --name value');
    const name=args[i].slice(2);if(Object.hasOwn(result,name))throw new Error(`Duplicate option --${name}`);result[name]=args[i+1];
  }
  return result;
}
async function readJSON(path) { const raw=await readFile(path,'utf8');if(Buffer.byteLength(raw)>524288)throw new Error('JSON file exceeds 524288 bytes');return JSON.parse(raw); }
async function privateJSON(path,value) {
  const destination=resolve(path);await mkdir(dirname(destination),{recursive:true,mode:0o700});
  const file=await open(destination,'wx',0o600);try {await file.writeFile(`${canonicalJSON(value)}\n`);await file.sync();}finally{await file.close();}
}
function output(value) { process.stdout.write(`${JSON.stringify(value,null,2)}\n`); }
async function fixtureWorker() {
  let data='';for await(const chunk of process.stdin) {data+=chunk;if(data.length>1000000)throw new Error('Fixture input limit exceeded');}
  const {packet,privateKey}=JSON.parse(data);
  if(payloadDigest(packet.payload)!==packet.digest)throw new Error('Fixture received a damaged dispatch');
  const at=Math.max(Date.now(),packet.payload.issuedAt);
  const binding={request:packet.payload,requestDigest:packet.digest,at};
  const ack=signEnvelope({schema:'ngl.courier.ack.v1',...binding,accepted:true},privateKey);
  // A real local computation: canonicalize and hash the input in this child process.
  const reply=signEnvelope({schema:'ngl.courier.reply.v1',...binding,output:{kind:'local-fixture-sha256',inputDigest:payloadDigest(packet.payload.input),inputBytes:Buffer.byteLength(canonicalJSON(packet.payload.input)),processId:process.pid},dissent:'Fixture computation supplies no external model judgment or Founder approval.'},privateKey);
  output({pid:process.pid,ack,reply});
}
async function demo(opts) {
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const courier=await createCourier({dataDir:opts['data-dir'],providers:[{id:'local-fixture',publicKey:publicKey.export({format:'pem',type:'spki'}),capabilities:['fixture.hash']}]});
  const request=await courier.dispatch({requestId:'fixture-demonstration',capability:'fixture.hash',input:{message:'A real local signed child computation; no external AI provider.'},expiresAt:Date.now()+60000});
  const packet=await courier.exportDispatch(request.requestId,'local-fixture');
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'_fixture-worker'],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
  let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  const exited=new Promise((accept,reject)=>{
    child.on('error',reject);child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1000000)child.kill('SIGKILL');});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>10000)child.kill('SIGKILL');});
    child.on('close',code=>code===0?accept():reject(new Error(`Fixture child failed (${code}): ${stderr.slice(0,1000)}`)));
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify({packet,privateKey:privateKey.export({format:'pem',type:'pkcs8'})}));
  let worker;
  try {await exited;worker=JSON.parse(stdout);} catch(cause) {await courier.fail({requestId:request.requestId,providerId:'local-fixture',reason:'Local fixture worker failed'});throw cause;}finally{clearTimeout(timer);}
  await courier.acknowledge(worker.ack);const result=await courier.respond(worker.reply);
  if(opts.out)await privateJSON(opts.out,{packet,ack:worker.ack,reply:worker.reply});
  output({mode:'LOCAL_SIGNED_FIXTURE',externalProviderExecuted:false,worker:{pid:worker.pid},request:result,limitations:['Disposable key generated only for this demonstration; it is never written to disk.','This executes a local hash worker, not an external model or independent Council seat.','A Council response does not grant Founder permissions.']});
}

try {
  if(command==='_fixture-worker')await fixtureWorker();
  else if(command==='help')process.stdout.write(`Durable signed file courier (Node built-ins only)\n\nCommands:\n  dispatch --data-dir DIR [--providers public-providers.json] --request request.json [--out packet.json]\n  import --data-dir DIR --file signed-receipt.json\n  status --data-dir DIR\n  export --data-dir DIR --request-id ID --provider-id ID --out packet.json\n  demo --data-dir NEW_PRIVATE_DIR [--out fixture-receipts.json]\n\nProvider file: [{id,publicKey:Ed25519_SPKI_PEM,capabilities:[...],available?:true}].\nDispatch request: {requestId?,capability,input,providerIds?,nonce?,expiresAt?}.\nUse a new data directory for demo; keys are disposable and never persisted.\nOutput files use exclusive creation and mode 0600. No external providers are called.\n`);
  else {
    const opts=options(process.argv.slice(3));if(!opts['data-dir'])throw new Error('--data-dir is required');
    if(command==='demo')await demo(opts);
    else {
      const providers=opts.providers ? await readJSON(opts.providers) : undefined;
      const courier=await createCourier({dataDir:opts['data-dir'],providers});
      if(command==='status')output(await courier.snapshot());
      else if(command==='dispatch') {
        if(!opts.request)throw new Error('--request JSON file is required');
        const request=await courier.dispatch(await readJSON(opts.request));
        const packets=[];for(const seat of request.seats)if(seat.status==='DISPATCHED' || seat.status==='ACKNOWLEDGED')packets.push(await courier.exportDispatch(request.requestId,seat.providerId));
        if(opts.out)await privateJSON(opts.out,packets.length===1?packets[0]:packets);
        output({request,packets});
      } else if(command==='import') {
        if(!opts.file)throw new Error('--file signed receipt JSON is required');
        const envelope=await readJSON(opts.file);
        if(envelope.payload?.schema==='ngl.courier.ack.v1')output(await courier.acknowledge(envelope));
        else if(envelope.payload?.schema==='ngl.courier.reply.v1')output(await courier.respond(envelope));
        else throw new Error('Only signed ack/reply envelopes may be imported');
      } else if(command==='export') {
        if(!opts.out || !opts['request-id'] || !opts['provider-id'])throw new Error('--request-id, --provider-id and --out are required');
        const packet=await courier.exportDispatch(opts['request-id'],opts['provider-id']);await privateJSON(opts.out,packet);output(packet);
      } else throw new Error(`Unknown command: ${command}`);
    }
  }
} catch(cause) { process.stderr.write(`${JSON.stringify({error:cause.code || 'COURIER_ERROR',message:cause.message})}\n`);process.exitCode=1; }
