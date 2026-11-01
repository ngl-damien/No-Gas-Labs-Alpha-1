import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWindowsAclSnapshot } from '../src/windows-acl.mjs';

const CURRENT = 'S-1-5-21-111111111-222222222-333333333-1001';

test('Windows ACL snapshot accepts only the current owner and trusted operating-system principals', () => {
  assert.equal(validateWindowsAclSnapshot({
    ownerSid: CURRENT,
    currentSid: CURRENT,
    rules: [
      { sid: CURRENT, accessType: 'Allow' },
      { sid: 'S-1-5-18', accessType: 'Allow' },
      { sid: 'S-1-5-32-544', accessType: 'Allow' },
      { sid: 'S-1-3-0', accessType: 'Allow' },
      { sid: 'S-1-1-0', accessType: 'Deny' }
    ]
  }, 'TEST'), true);
});

test('Windows ACL snapshot rejects a file owned by another Windows identity', () => {
  assert.throws(() => validateWindowsAclSnapshot({
    ownerSid: 'S-1-5-21-999999999-888888888-777777777-1002',
    currentSid: CURRENT,
    rules: [{ sid: CURRENT, accessType: 'Allow' }]
  }, 'TEST'), /TEST_OWNER_MISMATCH/);
});

test('Windows ACL snapshot rejects Everyone or any unknown allow principal', () => {
  assert.throws(() => validateWindowsAclSnapshot({
    ownerSid: CURRENT,
    currentSid: CURRENT,
    rules: [
      { sid: CURRENT, accessType: 'Allow' },
      { sid: 'S-1-1-0', accessType: 'Allow' }
    ]
  }, 'TEST'), /TEST_PERMISSIONS_TOO_BROAD/);
});

test('Windows ACL snapshot fails closed on malformed or incomplete ACL data', () => {
  assert.throws(() => validateWindowsAclSnapshot({ ownerSid: CURRENT, currentSid: CURRENT }, 'TEST'),
    /TEST_OWNER_VERIFICATION_FAILED/);
  assert.throws(() => validateWindowsAclSnapshot({
    ownerSid: CURRENT,
    currentSid: CURRENT,
    rules: [{ sid: 'not-a-sid', accessType: 'Allow' }]
  }, 'TEST'), /TEST_OWNER_VERIFICATION_FAILED/);
});
