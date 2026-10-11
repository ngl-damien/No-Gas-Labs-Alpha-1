#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {auditBranchHeads,reviewQueue} from "../src/evidence/branch-custody.js";
const file=process.argv[2];
if(!file) {
  process.stderr.write("Usage: node tools/branch-custody.mjs <branches-json-file>\n");
  process.exitCode=2;
} else {
  const branches=JSON.parse(await readFile(file,"utf8"));
  const audit=auditBranchHeads(branches);
  process.stdout.write(JSON.stringify({...audit,review_queue:reviewQueue(audit)},null,2)+"\n");
}
