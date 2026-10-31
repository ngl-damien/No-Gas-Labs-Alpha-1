import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';

const KEY = 'test-founder-key-not-a-production-secret';

test('shared Witness can preserve a server-revalidated response against its exact public packet and recover it after restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-collaborator-archive-'));
  let server = null;
  t.after(async () => { if (server) await server.closeGame().catch(() => {}); await rm(dataDir, { recursive: true, force: true }); });
  server = await createGameServer({ dataDir, founderKey: KEY });
  let url = '';
  let cookie = '';
  const listen = async instance => {
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${instance.address().port}`;
  };
  const request = async (path, body) => {
    const headers = { ...(cookie ? { cookie } : {}) };
    if (body !== undefined) { headers['content-type'] = 'application/json'; headers.origin = url; }
    const response = await fetch(url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { response, body: await response.json() };
  };
  await listen(server);
  const login = await request('/api/login', { key: KEY, name: 'Damien' });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.viewer.role, 'founder');

  const draft = await request('/api/action', {
    type: 'draft', kind: 'custom', title: 'Private draft marker',
    intent: 'This Founder-only event must not leak into a Witness packet.',
    html: '<!doctype html><html><body>Private draft</body></html>'
  });
  assert.equal(draft.response.status, 200, JSON.stringify(draft.body));

  const logout = await request('/api/logout', {});
  assert.equal(logout.response.status, 200);
  assert.equal(logout.body.viewer.role, 'witness');

  const proposal = await request('/api/action', {
    type: 'propose-moonshot',
    title: 'A bounded shared question',
    hypothesis: 'A retained process may produce a repeatable result.',
    falsifier: 'A controlled repeat does not reproduce it.',
    evidenceNeeded: 'A retained procedure and inspectable output.',
    sourceCreationId: null,
    sourceVersion: null
  });
  assert.equal(proposal.response.status, 200, JSON.stringify(proposal.body));

  const report = await request('/api/action', {
    type: 'report-experiment',
    moonshotId: proposal.body.result.moonshotId,
    procedure: 'Repeat the recorded procedure under the stated conditions.',
    observation: 'The second run did not reproduce the reported behavior.',
    reportedOutcome: 'failed',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  assert.equal(report.response.status, 200, JSON.stringify(report.body));

  const packet = projectCollaboratorPackets(report.body.world).find(item => item.id === 'adversary');
  assert.ok(packet?.available);
  const reportEvent = report.body.world.events.find(event => event.type === 'experiment-reported');
  const payload = JSON.parse(packet.packetJson);
  assert.equal(payload.sourceSnapshot.revision, report.body.world.revision);
  assert.equal(payload.sourceSnapshot.suppliedEventCount, report.body.world.events.length);
  assert.ok(payload.sourceSnapshot.suppliedEventCount < payload.sourceSnapshot.revision,
    'the Witness packet discloses that Founder-only draft history was omitted');

  const responseText = JSON.stringify({
    targetEventId: reportEvent.id,
    challengeType: 'reproducibility',
    challengeDraft: 'The report does not show that the second run used identical environmental conditions.',
    distinctnessAssessment: 'This asks for a discriminating control rather than asserting the report is false.',
    duplicateOfEventIds: [],
    counterexample: 'A controlled repeat under identical conditions reproduces the behavior.',
    evidenceNeeded: ['A second run with recorded environmental conditions.'],
    unknowns: ['Whether the two runs used identical conditions.']
  });
  const archived = await request('/api/action', {
    type: 'record-collaborator-response',
    role: packet.id,
    moonshotId: packet.moonshotId,
    packetJson: packet.packetJson,
    sourceEventIds: [...packet.inputRefs],
    responseText
  });
  assert.equal(archived.response.status, 200, JSON.stringify(archived.body));
  assert.equal(archived.body.result.validationStatus, 'valid-for-human-review');
  const event = archived.body.world.events.at(-1);
  assert.equal(event.type, 'collaborator-response-recorded');
  assert.equal(event.actor.role, 'witness');
  assert.equal(event.packetJson, packet.packetJson);
  assert.equal(event.responseText, responseText);
  assert.equal(archived.body.world.xp, 0);

  await server.closeGame();
  server = await createGameServer({ dataDir, founderKey: KEY });
  await listen(server);
  cookie = '';
  const recovered = await request('/api/login', { key: KEY, name: 'Damien' });
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body));
  const retained = recovered.body.world.events.find(item => item.responseId === event.responseId);
  assert.ok(retained, 'the exact collaborator response survives a service restart');
  assert.equal(retained.packetJson, packet.packetJson);
  assert.equal(retained.responseText, responseText);
  assert.equal(retained.validationStatus, 'valid-for-human-review');
  assert.equal(recovered.body.world.xp, 0);
});
