import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2);
if(args.length!==3)throw Error('Usage: node scripts/preserve-evidence.mjs verification-dir browser-dir throughput-report');
const [verificationDir,browserDir,throughputFile]=args.map(p=>resolve(p)),destination=join(root,'docs/meteor/evidence');
await mkdir(destination,{recursive:true});
const verification=JSON.parse(await readFile(join(verificationDir,'report.json'),'utf8'));
const testOutput=await readFile(join(verificationDir,'tests.stdout.log'),'utf8');
const exercise=JSON.parse(await readFile(join(verificationDir,'exercise/exercise.json'),'utf8'));
const browser=JSON.parse(await readFile(join(browserDir,'results.json'),'utf8'));
const throughput=JSON.parse(await readFile(throughputFile,'utf8'));
if(!verification.passed||exercise.courier.status!=='RESPONDED'||!exercise.repository.integrity.passed||!browser.filter(r=>r.status!=='blocked').every(r=>r.passed))throw Error('Unsuccessful run cannot be preserved as a passing commission');
const count=/[ℹ#]\s*tests\s+(\d+)/.exec(testOutput)?.[1];
if(!count)throw Error('Actual test count missing');
const records={
 'verification.json':{...verification,tests:Number(count),testOutputSHA256:createHash('sha256').update(testOutput).digest('hex')},
 'institutional-exercise.json':exercise,
 'browser.json':browser,
 'throughput.json':throughput,
 'evidence-index.json':{schema:'ngl.commission-evidence.v1',recordedAt:new Date().toISOString(),sourcePaths:{verificationDir,browserDir,throughputFile},note:'Archived local execution evidence. Original logs and Forge source copies remain private runtime artifacts; these paths may not survive a new cloud instance.'}
};
for(const[name,value]of Object.entries(records))await writeFile(join(destination,name),JSON.stringify(value,null,2)+'\n');
await writeFile(join(destination,'test-output.txt'),testOutput);
for(const name of ['desktop.png','phone.png','shared-desktop.png','shared-phone.png','one-button-320-world.png','one-button-412-stage.png']){
 try{await copyFile(join(browserDir,name),join(destination,name));}catch(e){if(e.code!=='ENOENT')throw e;}
}
console.log(JSON.stringify({destination,tests:Number(count),verificationWallMs:verification.wallMs,repositoryTests:exercise.repository.tests.tests,browserJourneys:browser.length}));
