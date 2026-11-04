import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';
import { artifactReceipt } from '../src/institution/kernel.mjs';

const key = 'explicitly-fake-decision-http-test-key';

async function host(directory, founderTrustAnchorPath) {
  const server = await createGameServer({ dataDir: directory, founderKey: key, founderTrustAnchorPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    url,
    client() {
      let cookie = '';
      return {
        async request(path, value, headers = {}) {
          const response = await fetch(url + path, {
            method: value === undefined ? 'GET' : 'POST',
            headers: {
              cookie,
              ...(value === undefined ? {} : { 'content-type': 'application/json', origin: url }),
              ...headers
            },
            ...(value === undefined ? {} : { body: JSON.stringify(value) })
          });
          if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
          return { status: response.status, body: await response.json() };
        }
      };
    }
  };
}

async function writeTrustAnchor(directory, value) {
  const path = join(directory, 'founder.pub.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

test('HTTP Founder Gate keeps dispositions fail-closed until signed verification is integrated and recovers pending decisions after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decision-http-'));
  const trustPath = await writeTrustAnchor(directory, {
    schema: 'ngl.founder-trust-anchor.v1',
    status: 'NOT_ENROLLED',
    enrolled: false,
    mode: null,
    public_key_jwk: null,
    fingerprint: null
  });
  let hostState = await host(directory, trustPath);
  try {
    const owner = hostState.client();
    const witness = hostState.client();
    assert.equal((await witness.request('/api/decisions/policy', {
      id: 'fixture', reviewWindowMs: 86400000, basis: 'synthetic test policy'
    })).status, 403);
    assert.equal((await owner.request('/api/login', { key })).status, 200);

    const policy = await owner.request('/api/decisions/policy', {
      id: 'fixture', reviewWindowMs: 86400000, basis: 'synthetic test policy, not operational activation'
    });
    assert.equal(policy.status, 200, JSON.stringify(policy.body));

    const bytes = 'PRIVATE_EVALUATION_FIXTURE';
    const proposal = {
      id: 'fixture-review',
      title: 'Synthetic comparison',
      evaluation: { bytes, receipt: artifactReceipt(bytes) },
      risks: ['Fixture only'],
      rollback: 'No source changed',
      proposedEffect: 'Record a fixture decision; no promotion'
    };
    assert.equal((await witness.request('/api/decisions/proposals', proposal)).status, 403);
    const created = await owner.request('/api/decisions/proposals', proposal);
    assert.equal(created.status, 200);
    assert.equal(created.body.status, 'PENDING');
    assert.match(JSON.stringify((await owner.request('/api/decisions')).body), /PRIVATE_EVALUATION_FIXTURE/);
    assert.doesNotMatch(JSON.stringify((await witness.request('/api/decisions')).body), /PRIVATE_EVALUATION_FIXTURE|synthetic test policy/);

    const choice = { decisionId: proposal.id, expectedRevision: 1, requestId: 'fixture-choice-1', action: 'APPROVE' };
    assert.equal((await owner.request('/api/decisions/choose', choice, {
      origin: 'https://unrelated.invalid'
    })).status, 403);

    const beforeForged = (await owner.request('/api/decisions')).body;
    assert.equal(beforeForged.dispositionAuthorization.available, false);
    assert.equal(beforeForged.dispositionAuthorization.code, 'FOUNDER_NOT_ENROLLED');
    const forged = await owner.request('/api/decisions/choose', {
      ...choice, verification: { valid: true }
    });
    assert.equal(forged.status, 503);
    assert.equal(forged.body.error.code, 'FOUNDER_NOT_ENROLLED');

    const afterForged = (await owner.request('/api/decisions')).body;
    assert.equal(afterForged.revision, beforeForged.revision);
    assert.equal(afterForged.decisions[0].status, 'PENDING');
    assert.equal(afterForged.decisions[0].revision, beforeForged.decisions[0].revision);

    assert.equal((await witness.request('/api/decisions/choose', choice)).status, 403);
    const blockedChoice = await owner.request('/api/decisions/choose', choice);
    assert.equal(blockedChoice.status, 503);
    assert.equal(blockedChoice.body.error.code, 'FOUNDER_NOT_ENROLLED');
    assert.equal((await owner.request('/api/decisions/choose', choice)).status, 503);
    const blockedReject = await owner.request('/api/decisions/choose', { ...choice, action: 'REJECT' });
    assert.equal(blockedReject.status, 503);
    const afterBlockedChoices = (await owner.request('/api/decisions')).body;
    assert.equal(afterBlockedChoices.revision, beforeForged.revision);
    assert.equal(afterBlockedChoices.decisions[0].status, 'PENDING');

    await hostState.server.closeGame();
    hostState = await host(directory);
    const fresh = hostState.client();
    assert.equal((await fresh.request('/api/state')).body.viewer.role, 'witness');
    await fresh.request('/api/login', { key });
    const restored = (await fresh.request('/api/decisions')).body;
    assert.equal(restored.decisions[0].status, 'PENDING');
    assert.equal(restored.revision, beforeForged.revision);
    assert.equal(restored.dispositionAuthorization.code, 'FOUNDER_NOT_ENROLLED');
    assert.equal(restored.policy.reviewWindowMs, 86400000);
  } finally {
    await hostState.server.closeGame();
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTTP Founder Gate does not unlock dispositions for a TEST_ONLY trust anchor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decision-test-anchor-'));
  const trustPath = await writeTrustAnchor(directory, {
    schema: 'ngl.founder-trust-anchor.v1',
    status: 'ENROLLED',
    enrolled: true,
    mode: 'TEST_ONLY',
    public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) },
    fingerprint: 'a'.repeat(64)
  });
  const hostState = await host(directory, trustPath);
  try {
    const owner = hostState.client();
    await owner.request('/api/login', { key });
    const before = (await owner.request('/api/decisions')).body;
    assert.equal(before.dispositionAuthorization.available, false);
    assert.equal(before.dispositionAuthorization.code, 'FOUNDER_TRUST_ANCHOR_TEST_ONLY');
    const blocked = await owner.request('/api/decisions/choose', {
      decisionId: 'not-installed',
      expectedRevision: 1,
      requestId: 'test-anchor-choice',
      action: 'APPROVE'
    });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error.code, 'FOUNDER_TRUST_ANCHOR_TEST_ONLY');
    const after = (await owner.request('/api/decisions')).body;
    assert.equal(after.revision, before.revision);
    assert.equal(after.decisions.length, 0);
  } finally {
    await hostState.server.closeGame();
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTTP Founder Gate reports an unreadable trust anchor and blocks dispositions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decision-bad-anchor-'));
  const trustPath = join(directory, 'founder.pub.json');
  await writeFile(trustPath, '{');
  const hostState = await host(directory, trustPath);
  try {
    const owner = hostState.client();
    await owner.request('/api/login', { key });
    const before = (await owner.request('/api/decisions')).body;
    assert.equal(before.dispositionAuthorization.available, false);
    assert.equal(before.dispositionAuthorization.code, 'FOUNDER_TRUST_ANCHOR_UNAVAILABLE');
    const blocked = await owner.request('/api/decisions/choose', {
      decisionId: 'not-installed',
      expectedRevision: 1,
      requestId: 'bad-anchor-choice',
      action: 'APPROVE'
    });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error.code, 'FOUNDER_TRUST_ANCHOR_UNAVAILABLE');
    const after = (await owner.request('/api/decisions')).body;
    assert.equal(after.revision, before.revision);
    assert.equal(after.decisions.length, 0);
  } finally {
    await hostState.server.closeGame();
    await rm(directory, { recursive: true, force: true });
  }
});


test('project projection has no synthetic accomplishments or implicit authority when no report is installed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-project-http-'));
  const hostState = await host(directory);
  try {
    const viewer = hostState.client();
    const result = await viewer.request('/api/projects');
    assert.equal(result.status, 200);
    assert.equal(result.body.projects.length, 0);
    assert.equal(result.body.witnessParticipation, 'UNVERIFIED');
    assert.equal((await viewer.request('/api/state')).body.world.xp, 0);
  } finally {
    await hostState.server.closeGame();
    await rm(directory, { recursive: true, force: true });
  }
});
