import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const CREATOR_OWNER_SID = 'S-1-3-0';

function fail(label, reason) {
  throw new Error(label + '_' + reason);
}

/**
 * Validate a PowerShell Get-Acl snapshot without trusting localized account names.
 * Only the file owner, SYSTEM, local Administrators, and the special CREATOR OWNER
 * inheritance SID may have allow ACEs. Broad or unknown allow principals fail closed.
 */
export function validateWindowsAclSnapshot(snapshot, label = 'FOUNDER_KEY') {
  if (typeof label !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(label) ||
      !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      typeof snapshot.ownerSid !== 'string' || !/^S-\d(?:-\d+)+$/.test(snapshot.ownerSid) ||
      typeof snapshot.currentSid !== 'string' || !/^S-\d(?:-\d+)+$/.test(snapshot.currentSid) ||
      !Array.isArray(snapshot.rules)) {
    fail(label, 'OWNER_VERIFICATION_FAILED');
  }

  if (snapshot.ownerSid !== snapshot.currentSid) fail(label, 'OWNER_MISMATCH');

  const allowed = new Set([
    snapshot.currentSid,
    SYSTEM_SID,
    ADMINISTRATORS_SID,
    CREATOR_OWNER_SID
  ]);
  let currentUserAllowed = false;
  for (const rule of snapshot.rules) {
    if (!rule || typeof rule !== 'object' ||
        typeof rule.sid !== 'string' || !/^S-\d(?:-\d+)+$/.test(rule.sid) ||
        !['Allow', 'Deny'].includes(rule.accessType)) {
      fail(label, 'OWNER_VERIFICATION_FAILED');
    }
    if (rule.accessType === 'Allow') {
      if (!allowed.has(rule.sid)) fail(label, 'PERMISSIONS_TOO_BROAD');
      if (rule.sid === snapshot.currentSid) currentUserAllowed = true;
    }
  }
  if (!currentUserAllowed) fail(label, 'OWNER_VERIFICATION_FAILED');
  return true;
}

const POWERSHELL_SNAPSHOT = [
  "$ErrorActionPreference = 'Stop'",
  "$path = $env:NGL_ACL_TARGET",
  "if ([string]::IsNullOrWhiteSpace($path)) { throw 'NGL_ACL_TARGET_REQUIRED' }",
  "$acl = Get-Acl -LiteralPath $path",
  "$ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
  "$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {",
  "  [pscustomobject]@{ sid = $_.IdentityReference.Value; accessType = $_.AccessControlType.ToString() }",
  "})",
  "[pscustomobject]@{ ownerSid = $ownerSid; currentSid = $currentSid; rules = $rules } | ConvertTo-Json -Compress -Depth 4"
].join('\n');

export function verifyWindowsFileSecurity(path, label = 'FOUNDER_KEY') {
  if (process.platform !== 'win32' || typeof path !== 'string' || !path) {
    fail(label, 'OWNER_VERIFICATION_UNAVAILABLE');
  }
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== 'string' || !systemRoot) {
    fail(label, 'OWNER_VERIFICATION_UNAVAILABLE');
  }
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(POWERSHELL_SNAPSHOT, 'utf16le').toString('base64');
  const result = spawnSync(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded
  ], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 64 * 1024,
    env: { ...process.env, NGL_ACL_TARGET: path }
  });
  if (result.error || result.status !== 0) fail(label, 'OWNER_VERIFICATION_FAILED');

  let snapshot;
  try { snapshot = JSON.parse(result.stdout.trim()); }
  catch { fail(label, 'OWNER_VERIFICATION_FAILED'); }
  return validateWindowsAclSnapshot(snapshot, label);
}
