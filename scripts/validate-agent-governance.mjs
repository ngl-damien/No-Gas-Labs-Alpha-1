import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'CODEX.md',
  '.github/copilot-instructions.md',
  'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md'
];

const failures = [];
for (const relative of required) {
  try {
    const body = await readFile(resolve(root, relative), 'utf8');
    if (!body.trim()) failures.push(relative + ': file is empty');
    if (relative !== 'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md' &&
        !body.includes('AGENTS.md') &&
        !body.includes('RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md')) {
      failures.push(relative + ': missing mandatory instruction pointer');
    }
  } catch (error) {
    failures.push(relative + ': cannot read (' + error.code + ')');
  }
}

try {
  const entry = await readFile(resolve(root, 'AGENTS.md'), 'utf8');
  for (const marker of [
    'STOP: Read this file before',
    'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md',
    'Do not merge, release, deploy',
    'durable, factual record'
  ]) {
    if (!entry.includes(marker)) failures.push('AGENTS.md: missing required rule: ' + marker);
  }
} catch {}

try {
  const protocol = await readFile(resolve(root, 'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md'), 'utf8');
  for (const marker of [
    'Worker A',
    'Worker B',
    'Required loop on every run',
    'Shared work coordination rules',
    'Evidence and state rules',
    'Founder authority remains with Damien'
  ]) {
    if (!protocol.includes(marker)) failures.push('protocol: missing required section marker: ' + marker);
  }
} catch {}

if (failures.length) {
  console.error('Agent governance validation FAILED');
  for (const failure of failures) console.error('- ' + failure);
  process.exitCode = 1;
} else {
  console.log('Agent governance validation passed: mandatory entry points and shared protocol are present.');
}
