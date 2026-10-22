#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compareCandidates, forgeCapabilities, verifyRepository } from '../src/forge/runner.mjs';

const root = resolve(import.meta.dirname, '..');
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === 'list') {
    console.log(JSON.stringify(forgeCapabilities(), null, 2));
  } else if (args.length === 3 && args[0] === 'verify' && args[1] === '--out' && args[2]) {
    const report = await verifyRepository({ sourceDir: root, outDir: args[2] });
    console.log(JSON.stringify({ schema: report.schema, taskId: report.taskId, report: join(resolve(args[2]), 'report.json'), outcome: report.outcome, correct: report.correct, tests: report.tests, timing: report.timing, reason: report.reason }, null, 2));
    if (!report.correct) process.exitCode = 1;
  } else if (args.length === 3 && args[0] === 'demo' && args[1] === '--out' && args[2]) {
    const candidates = [];
    for (const id of ['correct', 'wrong', 'timeout']) {
      candidates.push({ id, overlay: { 'fixtures/forge/workload/candidate.mjs': await readFile(join(root, 'fixtures/forge/candidates', `${id}.mjs`), 'utf8') } });
    }
    const report = await compareCandidates({ sourceDir: root, outDir: args[2], candidates, limits: { timeoutMs: 500, maxOutputBytes: 65536, concurrency: 1 } });
    console.log(JSON.stringify({ schema: report.schema, taskId: report.taskId, report: join(resolve(args[2]), 'report.json'), results: report.results.map(({ id, outcome, timing }) => ({ id, outcome, timing })), timing: report.timing }, null, 2));
    const expected = ['passing', 'failed', 'timed_out'];
    if (!report.results.every((result, index) => result.outcome === expected[index])) process.exitCode = 1;
  } else {
    throw new Error('Usage: node scripts/forge.mjs list | demo --out <fresh-directory> | verify --out <fresh-directory>');
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
