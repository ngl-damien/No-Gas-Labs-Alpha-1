import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));

/** Build a real, public starter exhibit from admitted private-world actions, without a provider call. */
export async function buildExhibition({rootDir=ROOT,outDir=join(rootDir,'dist')}={}){
 const {createWorld,applyAction}=await import(pathToFileURL(join(rootDir,'game/model.mjs')).href);
 const {rehearseLaunch,makeLaunchPage}=await import(pathToFileURL(join(rootDir,'game/launchpad.mjs')).href);
 const previous=globalThis.NGL_ASSETS,pages=[];
 for(const stem of ['cover_a','p3','p4','p5','p10','p13'])pages.push({path:`/assets/comic/${stem}.jpg`,src:'data:image/jpeg;base64,'+(await readFile(join(rootDir,'game/assets/comic',stem+'.jpg'))).toString('base64'),label:stem==='cover_a'?'America’s Got Problems · original cover':`Original No_Gas_Labs comic · ${stem}`});
 globalThis.NGL_ASSETS={pages};
 try{
  let world=createWorld({founderName:'Damien Featherstone'});const actor={id:'private-exhibition-owner',name:'Damien Featherstone',role:'founder'};
  for(const[kind,title,intent]of[['comic','America’s Got Problems','Read six original No_Gas_Labs comic pages.'],['loom','The Sentence Loom','Turn Unicode into an audible, inspectable pattern.'],['observatory','The Source Observatory','Hold an observation beside its source and uncertainty.']]){
   let accepted=await applyAction(world,{type:'draft',kind,title,intent},actor);world=accepted.world;
   accepted=await applyAction(world,{type:'publish',draftId:accepted.result.draftId,expectedVersion:0},actor);world=accepted.world;
  }
  const report=await rehearseLaunch(world,{title:'One person. A world in progress.',tagline:'Made with AI, a browser, and the refusal to leave it as an idea.'});
  if(!report.ready)throw Error('Starter exhibition failed its technical rehearsal');
  const html=makeLaunchPage(world,report),summary={schema:report.schema,title:report.title,createdAt:report.createdAt,ready:report.ready,artifactCount:report.artifactCount,checks:report.checks,artifacts:report.exhibit.map(({id,title,kind,version,originalReceipt,portableReceipt})=>({id,title,kind,version,originalReceipt,portableReceipt})),limitations:report.limitations};
  await mkdir(outDir,{recursive:true});const htmlPath=resolve(outDir,'exhibition.html');await writeFile(htmlPath,html);await writeFile(resolve(outDir,'launch-checks.json'),JSON.stringify(summary,null,2)+'\n');
  return{htmlPath,summaryPath:resolve(outDir,'launch-checks.json'),artifactCount:3};
 }finally{if(previous===undefined)delete globalThis.NGL_ASSETS;else globalThis.NGL_ASSETS=previous;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await buildExhibition()));
