import {lstat,readFile,open,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const FILES=['service.json','decisions/decisions.json'];
const fail=message=>{throw Object.assign(new Error(message+' Restore the complete runtime offline; missing stores must not be initialized as a new institution.'),{code:'INCOMPLETE_RUNTIME'});};
async function regular(path){try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())fail('Required runtime member is not a regular file.');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
/** Inventory anchor, not a signature or a substitute for each store's replay checks. */
export async function ensureRuntimeLayout(directory){
 await mkdir(directory,{recursive:true,mode:0o700});
 const path=join(directory,'runtime-layout.json'),anchored=await regular(path);
 const present=await Promise.all(FILES.map(name=>regular(join(directory,name))));
 if(anchored){let layout;try{layout=JSON.parse(await readFile(path,'utf8'));}catch{fail('Runtime inventory is unreadable.');}
  if(layout.schema!=='ngl.runtime-layout.v1'||JSON.stringify(layout.files)!==JSON.stringify(FILES))fail('Runtime inventory does not identify the required stores.');
  if(!present.every(Boolean))fail('Initialized runtime is incomplete: required store missing.');
  return;
 }
 if(present.some(Boolean)&&!present.every(Boolean))fail('Partial prior runtime is incomplete.');
 if(!present.some(Boolean)&&await regular(join(directory,'founder.key')))fail('Prior Founder key exists but both institution stores are missing.');
 const file=await open(path,'wx',0o600);
 try{await file.writeFile(JSON.stringify({schema:'ngl.runtime-layout.v1',files:FILES})+'\n');await file.sync();}finally{await file.close();}
 const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
}
