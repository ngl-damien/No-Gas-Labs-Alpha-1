import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyAction, publicWorld, validateWorld } from '../game/model.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';
import { projectTownSquare } from '../game/social.mjs';

const founder = { id: 'damien', name: 'Damien', role: 'founder' };
const firstWitness = { id: 'witness-a', name: 'Witness A', role: 'witness' };
const secondWitness = { id: 'witness-b', name: 'Witness B', role: 'witness' };
const start = Date.parse('2026-10-31T08:00:00.000Z');
const at = seconds => new Date(start + seconds * 1000).toISOString();
async function act(world, action, actor, seconds) {
  return (await applyAction(world, action, actor, { now: at(seconds) })).world;
}

test('Commons posts are bounded, attributed, retained and never award progression', async () => {
  let world = createWorld({ now: at(0) });
  const before = projectCharacter(world, firstWitness);
  const outcome = await applyAction(world, { type: 'post-message', text: '  Hello, Commons.  ' }, firstWitness, {
    now: at(1),
    requestId: 'commons-post-001',
    actionFingerprint: 'a'.repeat(64)
  });
  world = outcome.world;
  assert.equal(outcome.result.messageId.startsWith('message-'), true);
  assert.equal(world.events[0].type, 'message-posted');
  assert.equal(world.events[0].channel, 'commons');
  assert.equal(world.events[0].text, 'Hello, Commons.');
  assert.equal(world.xp, 0);
  assert.equal(projectCharacter(world, firstWitness).xp, before.xp);
  assert.deepEqual((await validateWorld(world)).events, world.events);

  const projection = projectTownSquare(publicWorld(world, secondWitness), secondWitness);
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0].text, 'Hello, Commons.');
  assert.equal(projection.messages[0].author.id, firstWitness.id);
  assert.equal(projection.messages[0].canReport, true);
  assert.equal(projection.totalMessages, 1);
});

test('Commons rate limit permits five posts per actor per rolling minute and rejects the sixth', async () => {
  let world = createWorld({ now: at(0) });
  for (let second = 1; second <= 5; second += 1) {
    world = await act(world, { type: 'post-message', text: 'Message ' + second }, firstWitness, second);
  }
  await assert.rejects(
    act(world, { type: 'post-message', text: 'Message six' }, firstWitness, 6),
    error => error.code === 'COMMONS_RATE_LIMITED' && error.status === 429
  );
  assert.equal(world.events.filter(event => event.type === 'message-posted').length, 5);
  await validateWorld(world);
});

test('reports are private to the reporter and Founder, and duplicate or self-reports fail', async () => {
  let world = createWorld({ now: at(0) });
  world = await act(world, { type: 'post-message', text: 'Please review this message.' }, firstWitness, 1);
  const messageId = world.events[0].messageId;
  world = await act(world, {
    type: 'report-message', messageId, reason: 'privacy', details: 'Fixture-only report detail.'
  }, secondWitness, 2);
  await validateWorld(world);

  const firstView = publicWorld(world, firstWitness);
  assert.equal(firstView.events.some(event => event.type === 'message-reported'), false);
  assert.equal(JSON.stringify(firstView).includes('Fixture-only report detail.'), false);
  const reporterView = publicWorld(world, secondWitness);
  assert.equal(reporterView.events.filter(event => event.type === 'message-reported').length, 1);
  const founderView = projectTownSquare(publicWorld(world, founder), founder);
  assert.equal(founderView.pendingReports.length, 1);
  assert.equal(founderView.pendingReports[0].details, 'Fixture-only report detail.');
  assert.equal(projectTownSquare(reporterView, secondWitness).messages[0].canReport, false);

  await assert.rejects(
    act(world, { type: 'report-message', messageId, reason: 'privacy', details: 'Duplicate report.' }, secondWitness, 3),
    error => error.code === 'MESSAGE_ALREADY_REPORTED'
  );
  await assert.rejects(
    act(world, { type: 'report-message', messageId, reason: 'other', details: 'Self-report.' }, firstWitness, 3),
    error => error.code === 'SELF_REPORT'
  );
});

test('Founder moderation hides public text without erasing history and can later restore it', async () => {
  let world = createWorld({ now: at(0) });
  world = await act(world, { type: 'post-message', text: 'Original text remains in Founder history.' }, firstWitness, 1);
  const messageId = world.events[0].messageId;
  world = await act(world, {
    type: 'report-message', messageId, reason: 'privacy', details: 'Please review.'
  }, secondWitness, 2);

  await assert.rejects(
    act(world, { type: 'moderate-message', messageId, disposition: 'hide', reason: 'privacy' }, secondWitness, 3),
    error => error.code === 'FORBIDDEN'
  );
  const hidden = await applyAction(world, {
    type: 'moderate-message', messageId, disposition: 'hide', reason: 'privacy'
  }, founder, { now: at(3) });
  world = hidden.world;
  await validateWorld(world);

  const publicState = publicWorld(world, firstWitness);
  assert.equal(publicState.events.find(event => event.type === 'message-posted').text, '[Message hidden by human moderation.]');
  assert.equal(JSON.stringify(publicState).includes('Original text remains in Founder history.'), false);
  assert.equal(projectTownSquare(publicState, firstWitness).messages[0].text, 'This message was hidden after human review.');
  const founderProjection = projectTownSquare(publicWorld(world, founder), founder);
  assert.equal(founderProjection.messages[0].hidden, true);
  assert.equal(founderProjection.messages[0].text, 'Original text remains in Founder history.');
  assert.equal(founderProjection.pendingReports.length, 0);

  world = await act(world, {
    type: 'moderate-message', messageId, disposition: 'restore', reason: 'other'
  }, founder, 4);
  await validateWorld(world);
  assert.equal(publicWorld(world, firstWitness).events.find(event => event.type === 'message-posted').text, 'Original text remains in Founder history.');
  assert.equal(world.events.filter(event => event.type === 'message-posted').length, 1);
  assert.equal(world.xp, 0);
  assert.equal(projectCharacter(world, firstWitness).xp, 0);
});

test('a message cannot be hidden without a pending report; malformed event fields fail closed', async () => {
  let world = createWorld({ now: at(0) });
  world = await act(world, { type: 'post-message', text: 'Unreported message.' }, firstWitness, 1);
  const messageId = world.events[0].messageId;
  await assert.rejects(
    act(world, { type: 'moderate-message', messageId, disposition: 'hide', reason: 'other' }, founder, 2),
    error => error.code === 'MESSAGE_NOT_REPORTED'
  );
  const tampered = structuredClone(world);
  tampered.events[0].untrustedOutcome = 'approved';
  await assert.rejects(validateWorld(tampered), error => error.code === 'INVALID_WORLD');
});
