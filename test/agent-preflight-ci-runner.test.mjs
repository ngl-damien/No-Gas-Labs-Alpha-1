import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createReceiptPath, runPreflightCi } from '../scripts/run-agent-preflight-ci.mjs';

const validatorPath = fileURLToPath(new URL('../scripts/validate-agent-governance.mjs', import.meta.url));
const args = ['--path', 'AGENTS.md', '--checkpoint', 'docs/operations/LATEST_CHECKPOINT.md'];

test('CI preflight receipt paths are unique, repository-relative and non-overwriting', () => {
  const first = createReceiptPath();
  const second = createReceiptPath();
  assert.notEqual(first, second);
  assert.match(first, /^\.runtime\/agent-preflight-ci-[0-9a-f-]{36}\.json$/);
  assert.match(second, /^\.runtime\/agent-preflight-ci-[0-9a-f-]{36}\.json$/);
});

test('CI runner appends its unique receipt after the declared target arguments', () => {
  const calls = [];
  const status = runPreflightCi(args, (...call) => {
    calls.push(call);
    return { status: 0 };
  });
  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  const [executable, childArgs, options] = calls[0];
  assert.equal(executable, process.execPath);
  assert.equal(childArgs[0], validatorPath);
  assert.deepEqual(childArgs.slice(1, -2), args);
  assert.equal(childArgs.at(-2), '--receipt');
  assert.match(childArgs.at(-1), /^\.runtime\/agent-preflight-ci-[0-9a-f-]{36}\.json$/);
  assert.equal(options.stdio, 'inherit');
});

test('repeated CI runner invocations never reuse a receipt path', () => {
  const receipts = [];
  for (let index = 0; index < 3; index += 1) {
    runPreflightCi(args, (_executable, childArgs) => {
      receipts.push(childArgs.at(-1));
      return { status: 0 };
    });
  }
  assert.equal(new Set(receipts).size, receipts.length);
});

test('CI runner rejects caller-selected receipt paths and propagates spawn failures', () => {
  assert.throws(() => runPreflightCi(['--receipt', 'fixed.json'], () => ({ status: 0 })),
    /generated uniquely per run/);
  assert.throws(() => runPreflightCi([], () => ({ error: new Error('spawn failed') })), /spawn failed/);
});

test('CI runner preserves a blocked validator exit code instead of reporting success', () => {
  for (const exitCode of [1, 7]) {
    assert.equal(runPreflightCi(args, () => ({ status: exitCode })), exitCode);
  }
});

test('CI runner fails closed when the validator is terminated without an exit code', () => {
  assert.equal(runPreflightCi(args, () => ({ status: null, signal: 'SIGTERM' })), 1);
});
