import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Android emulator acceptance allows cold macOS boot without consuming the instrumentation window', async () => {
  const source = await readFile(new URL('../.github/workflows/android-alpha1.yml', import.meta.url), 'utf8');
  const start = source.indexOf('      - name: Run offline-world emulator journey');
  const end = source.indexOf('      - name: Preserve debug APK', start);
  assert.ok(start >= 0 && end > start, 'the Android emulator journey step must remain present');

  const emulatorStep = source.slice(start, end);
  assert.match(emulatorStep, /^\\s{10}emulator-boot-timeout:\\s*900\\s*$/m,
    'allow a 15-minute cold boot on the observed slow macOS Intel runner');
  assert.match(source, /^\\s{4}timeout-minutes:\\s*40\\s*$/m,
    'retain the bounded 40-minute job ceiling');
  assert.equal((source.match(/test\\/android-workflow\\.test\\.mjs/g) ?? []).length, 3,
    'the regression must be in both workflow path filters and the Android preflight');
});
