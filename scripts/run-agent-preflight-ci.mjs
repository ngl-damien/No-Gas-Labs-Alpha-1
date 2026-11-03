import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const validatorPath = fileURLToPath(new URL('./validate-agent-governance.mjs', import.meta.url));
export const PREFLIGHT_TIMEOUT_MS = 120_000;

export function createReceiptPath() {
  return '.runtime/agent-preflight-ci-' + randomUUID() + '.json';
}

export function runPreflightCi(args = process.argv.slice(2), spawn = spawnSync) {
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    throw new TypeError('CI preflight arguments must be strings');
  }
  if (args.includes('--receipt')) {
    throw new Error('CI preflight receipt paths are generated uniquely per run; do not pass --receipt');
  }
  const receiptPath = createReceiptPath();
  const child = spawn(process.execPath, [validatorPath, ...args, '--receipt', receiptPath], {
    stdio: 'inherit',
    timeout: PREFLIGHT_TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });
  if (child.error) throw child.error;
  if (child.signal) return 1;
  return Number.isInteger(child.status) ? child.status : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runPreflightCi();
  } catch (error) {
    console.error('CI preflight runner failed:', error.message);
    process.exitCode = 1;
  }
}
