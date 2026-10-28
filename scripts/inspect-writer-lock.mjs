#!/usr/bin/env node
import { inspectWriterLock } from '../src/institution/lock-inspector.mjs';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: node scripts/inspect-writer-lock.mjs <lock-file-path>');
  process.exitCode = 2;
} else {
  try {
    const result = await inspectWriterLock(args[0]);
    console.log(JSON.stringify(result, null, 2));
    if (['unsafe', 'changed', 'malformed'].includes(result.status)) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      safeToRemove: false
    }, null, 2));
    process.exitCode = 1;
  }
}
