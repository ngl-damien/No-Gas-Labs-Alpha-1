import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
const ROOT=fileURLToPath(new URL('..',import.meta.url)),exec=promisify(execFile),started=performance.now();
await mkdir(join(ROOT,'.runtime'),{recursive:true});const out=await mkdtemp(join(ROOT,'.runtime/verification-'));
const stages=[];
for(const[name,bin,args,cwd]of[['tests',process.execPath,['--test'],ROOT],['python-inspector','python3',['-m','unittest','-v','test_engine.py'],join(ROOT,'experiments/AOTA-FEATHERSTONIAN-ENGINE')],['package',process.execPath,['scripts/build-game.mjs'],ROOT],['institutional-exercise',process.execPath,['scripts/meteor-demo.mjs','--out',join(out,'exercise')],ROOT]]){
 const at=performance.now();let stdout='',stderr='',exitCode=0;
 try{({stdout,stderr}=await exec(bin,args,{cwd,timeout:120000,maxBuffer:8*1024*1024}));}catch(e){stdout=e.stdout||'';stderr=e.stderr||e.message;exitCode=typeof e.code==='number'?e.code:1;}
 await writeFile(join(out,`${name}.stdout.log`),stdout,{mode:0o600});await writeFile(join(out,`${name}.stderr.log`),stderr,{mode:0o600});
 const record={name,command:[bin,...args],exitCode,wallMs:performance.now()-at};stages.push(record);console.log(JSON.stringify(record));
 if(exitCode){if(stdout)console.error(`[verify:${name}:stdout]\\n${stdout}`);if(stderr)console.error(`[verify:${name}:stderr]\\n${stderr}`);process.exitCode=1;break;}
}
const report={schema:'ngl.verification-run.v1',observedAt:new Date().toISOString(),passed:stages.length===4&&stages.every(s=>s.exitCode===0),stages,wallMs:performance.now()-started,limitations:['Browser acceptance is an additional check: python3 scripts/verify-browser.py.','These local results do not establish external publication, provider execution or independent human review.']};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({report:join(out,'report.json'),passed:report.passed,wallMs:report.wallMs}));
