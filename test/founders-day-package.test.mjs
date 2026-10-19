import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildGame} from '../scripts/build-game.mjs';
test('delivery includes a self-contained commemorative preview that cannot activate a review',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-founders-day-delivery-'));try{await buildGame({outDir:directory});const html=await readFile(join(directory,'founders-day.html'),'utf8');assert.match(html,/Carter Lake, Iowa/);assert.match(html,/NGL_FOUNDER_GATE_PREVIEW\s*=\s*true/);assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/<script\b[^>]*\bsrc=|<link\b[^>]*rel="stylesheet"/i);assert.match(html,/Download record/);}finally{await rm(directory,{recursive:true,force:true});}
});
