import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const CREATOR_OWNER_SID = 'S-1-3-0';

function fail(label, reason) {
  throw new Error(label + '_' + reason);
}

/**
 * Validate a Windows FileSecurity snapshot without trusting localized account names.
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

// Windows PowerShell 5.1's .NET FileInfo/DirectoryInfo ACL methods avoid depending on
// the Microsoft.PowerShell.Security module's Get-Acl cmdlet auto-import.
function powershellSnapshot(kind) {
  const entryType = kind === 'directory' ? 'DirectoryInfo' : 'FileInfo';
  return [
    "$ErrorActionPreference = 'Stop'",
    "$path = $env:NGL_ACL_TARGET",
    "if ([string]::IsNullOrWhiteSpace($path)) { throw 'NGL_ACL_TARGET_REQUIRED' }",
    `$entry = [System.IO.${entryType}]::new($path)`,
    "$acl = $entry.GetAccessControl()",
    "$ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
    "$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {",
    "  [pscustomobject]@{ sid = $_.IdentityReference.Value; accessType = $_.AccessControlType.ToString() }",
    "})",
    "[pscustomobject]@{ ownerSid = $ownerSid; currentSid = $currentSid; rules = $rules } | ConvertTo-Json -Compress -Depth 4"
  ].join(String.fromCharCode(10));
}

function verifyWindowsPathSecurity(path, label, kind) {
  if (process.platform !== 'win32' || typeof path !== 'string' || !path) {
    fail(label, 'OWNER_VERIFICATION_UNAVAILABLE');
  }
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== 'string' || !systemRoot) {
    fail(label, 'OWNER_VERIFICATION_UNAVAILABLE');
  }
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(powershellSnapshot(kind), 'utf16le').toString('base64');
  const result = spawnSync(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded
  ], {
    encoding: 'utf8',
    timeout: 15_000,
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

export function verifyWindowsFileSecurity(path, label = 'FOUNDER_KEY') {
  return verifyWindowsPathSecurity(path, label, 'file');
}

export function verifyWindowsDirectorySecurity(path, label = 'PRIVATE_DIRECTORY') {
  return verifyWindowsPathSecurity(path, label, 'directory');
}

function powershellSecure() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$path = $env:NGL_ACL_TARGET",
    "$kind = $env:NGL_ACL_KIND",
    "if ([string]::IsNullOrWhiteSpace($path)) { throw 'NGL_ACL_TARGET_REQUIRED' }",
    "$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')",
    "$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')",
    "$inherit = [System.Security.AccessControl.InheritanceFlags]::None",
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
    "$entry.SetAccessControl($acl)"
  ].join(String.fromCharCode(10));
}

function secureWindowsPathSecurity(path, label, kind) {
  if (process.platform !== 'win32' || typeof path !== 'string' || !path ||
      !['file', 'directory'].includes(kind)) {
    fail(label, 'OWNER_VERIFICATION_UNAVAILABLE');
  }
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== 'string' || !systemRoot) {
    fail(label, 'OWNER_VERIFICATION_UNAVAILABLE');
  }
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(powershellSecure(), 'utf16le').toString('base64');
  const result = spawnSync(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded
  ], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 64 * 1024,
    env: { ...process.env, NGL_ACL_TARGET: path, NGL_ACL_KIND: kind }
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.error?.message || result.stderr || result.stdout || 'PowerShell ACL setup failed')
      .replaceAll(path, '[path]').trim().slice(0, 800);
    fail(label, 'OWNER_VERIFICATION_FAILED: ' + detail);
  }
  return verifyWindowsPathSecurity(path, label, kind);
}

/** Apply the current user's private DACL only to a path created by this process. */
export function secureWindowsFileSecurity(path, label = 'PRIVATE_FILE') {
  return secureWindowsPathSecurity(path, label, 'file');
}

export function secureWindowsDirectorySecurity(path, label = 'PRIVATE_DIRECTORY') {
  return secureWindowsPathSecurity(path, label, 'directory');
}
