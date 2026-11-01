import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDecisions } from '../src/institution/decisions.mjs';
import { inspectWriterLock } from '../src/institution/lock-inspector.mjs';

const windowsOnly = { skip: process.platform !== 'win32' };
const founder = { id: 'damien', role: 'founder' };
const policy = {
  id: 'windows-acl-test-policy',
  reviewWindowMs: 60_000,
  basis: 'Synthetic Windows ACL regression fixture; not an operational review window.'
};
const now = () => Date.parse('2026-11-01T12:00:00.000Z');

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decision-acl-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function setWindowsAcl(path, kind, includeEveryone = false) {
  assert.equal(process.platform, 'win32');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$path = $env:NGL_DECISION_ACL_TARGET",
    "$kind = $env:NGL_DECISION_ACL_KIND",
    "$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')",
    "$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')",
    "$inherit = [System.Security.AccessControl.InheritanceFlags]::None",
    "$entry = $null",
    "$acl = $null",
    "if ($kind -eq 'directory') {",
    "  $entry = [System.IO.DirectoryInfo]::new($path)",
    "  $acl = [System.Security.AccessControl.DirectorySecurity]::new()",
    "  $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit",
    "} else {",
    "  $entry = [System.IO.FileInfo]::new($path)",
    "  $acl = [System.Security.AccessControl.FileSecurity]::new()",
    "}",
    "$acl.SetAccessRuleProtection($true, $false)",
    "$acl.SetOwner($current)",
    "$rights = [System.Security.AccessControl.FileSystemRights]::FullControl",
    "$none = [System.Security.AccessControl.PropagationFlags]::None",
    "$allow = [System.Security.AccessControl.AccessControlType]::Allow",
    "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($current, $rights, $inherit, $none, $allow))",
    "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($system, $rights, $inherit, $none, $allow))",
    "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($administrators, $rights, $inherit, $none, $allow))",
    "if ($env:NGL_DECISION_ACL_EVERYONE -eq '1') {",
    "  $everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')",
    "  $read = [System.Security.AccessControl.FileSystemRights]::Read",
    "  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($everyone, $read, $inherit, $none, $allow))",
    "}",
    "$entry.SetAccessControl($acl)"
  ].join('\n');
  const executable = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
  ], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 64 * 1024,
    env: {
      ...process.env,
      NGL_DECISION_ACL_TARGET: path,
      NGL_DECISION_ACL_KIND: kind,
      NGL_DECISION_ACL_EVERYONE: includeEveryone ? '1' : '0'
    }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('decision store reopens a private Windows ACL envelope and its live lease remains inspectable', windowsOnly, async t => {
  const directory = await temporaryDirectory(t);
  setWindowsAcl(directory, 'directory');

  const store = await openDecisions({ directory, now });
  try {
    await store.setPolicy(founder, policy);
    const lock = await inspectWriterLock(join(directory, '.decisions.lock'));
    assert.equal(lock.status, 'present');
    assert.equal(lock.format, 'owner-metadata');
    assert.equal(lock.safeToRemove, false);
  } finally {
    await store.close();
  }

  const reopened = await openDecisions({ directory, now });
  try {
    const snapshot = await reopened.snapshot(founder);
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.policy.id, policy.id);
  } finally {
    await reopened.close();
  }
});

test('decision store rejects a broad Windows ACL on its directory before creating a writer lease', windowsOnly, async t => {
  const directory = await temporaryDirectory(t);
  setWindowsAcl(directory, 'directory', true);

  await assert.rejects(
    openDecisions({ directory, now }),
    error => error.code === 'INVALID_CONFIG'
  );
  await assert.rejects(lstat(join(directory, '.decisions.lock')), error => error.code === 'ENOENT');
});

test('decision store rejects a broad Windows ACL on the persisted envelope and releases its lease', windowsOnly, async t => {
  const directory = await temporaryDirectory(t);
  setWindowsAcl(directory, 'directory');

  const store = await openDecisions({ directory, now });
  await store.setPolicy(founder, policy);
  await store.close();

  const envelope = join(directory, 'decisions.json');
  setWindowsAcl(envelope, 'file', true);
  await assert.rejects(
    openDecisions({ directory, now }),
    error => error.code === 'DECISIONS_TAMPERED'
  );
  await assert.rejects(lstat(join(directory, '.decisions.lock')), error => error.code === 'ENOENT');
});

test('lock inspector rejects a broad Windows ACL on a decision guard directory', windowsOnly, async t => {
  const root = await temporaryDirectory(t);
  const guard = join(root, '.decisions.lock.guard');
  await mkdir(guard);
  setWindowsAcl(guard, 'directory', true);

  const report = await inspectWriterLock(guard);
  assert.equal(report.status, 'unsafe');
  assert.equal(report.reason, 'permissions-too-broad');
  assert.equal(report.safeToRemove, false);
});

test('lock inspector rejects a broad Windows ACL on a guard owner receipt', windowsOnly, async t => {
  const root = await temporaryDirectory(t);
  const guard = join(root, '.decisions.lock.guard');
  await mkdir(guard);
  setWindowsAcl(guard, 'directory');

  const ownerPath = join(guard, '.owner-' + randomUUID() + '.json');
  await writeFile(ownerPath, JSON.stringify({
    schema: 'ngl.decisions-lock-guard.v1',
    pid: process.pid,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });
  setWindowsAcl(ownerPath, 'file', true);

  const report = await inspectWriterLock(guard);
  assert.equal(report.status, 'unsafe');
  assert.match(report.reason, /permissions-too-broad/);
  assert.equal(report.safeToRemove, false);
});

test('lock inspector accepts private Windows ACL lock metadata but never authorizes deletion', windowsOnly, async t => {
  const directory = await temporaryDirectory(t);
  const lockPath = join(directory, '.decisions.lock');
  await writeFile(lockPath, JSON.stringify({
    schema: 'ngl.decisions-lock.v1',
    pid: process.pid,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });
  setWindowsAcl(lockPath, 'file');

  const report = await inspectWriterLock(lockPath);
  assert.equal(report.status, 'present');
  assert.equal(report.format, 'owner-metadata');
  assert.equal(report.safeToRemove, false);
});
