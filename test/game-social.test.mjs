import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyAction, publicWorld, validateWorld } from '../game/model.mjs';
import { projectTownSquare, projectCommonsMessages } from '../game/social.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';

const founder = { id: 'damien', name: 'Damien Featherstone', role: 'founder' };
const witnessA = { id: 'witness-a', name: 'River Reader', role: 'witness' };
const witnessB = { id: 'witness-b', name: 'Bridge Keeper', role: 'witness' };
const witnessC = { id: 'witness-c', name: 'Night Archivist', role: 'witness' };
const start = Date.parse('2026-11-04T12:00:00.000Z');
const at = offset => new Date(start + offset).toISOString();
const fingerprint = 'a'.repeat(64);

async function post(world, actor, offset, text = 'A question worth carrying.') {
  return applyAction(world, { type: 'post-message', text }, actor, { now: at(offset) });
}

async function report(world, actor, offset, messageId, reason = 'other', details = 'Please review this in context.') {
  return applyAction(world, { type: 'report-message', messageId, reason, details }, actor, { now: at(offset) });
}

test('Commons posts become actor-scoped quest and Speaker projections without XP or evidence claims', async () => {
  const original = createWorld({ id: 'commons-world', now: at(0) });
  const posted = await post(original, witnessA, 1000, 'The world should keep its arguments, not just its winners.');
  const event = posted.world.events[0];
  assert.equal(event.type, 'message-posted');
  assert.equal(event.actor.id, witnessA.id);
  assert.equal(event.channel, 'commons');
  assert.equal(posted.world.xp, 0);
  assert.equal(original.events.length, 0);

  const feed = projectTownSquare(posted.world, witnessA);
  assert.equal(feed.totalMessages, 1);
  assert.equal(feed.messages.length, 1);
  assert.equal(feed.messages[0].text, event.text);
  assert.equal(feed.messages[0].canReport, false);
  assert.deepEqual(projectCommonsMessages(posted.world, witnessA).map(item => item.id), [event.id]);
  assert.equal(projectCommonsMessages(posted.world, witnessB).length, 0);

  const character = projectCharacter(posted.world, witnessA);
  assert.equal(character.xp, 0);
  assert.equal(character.worldXp, 0);
  assert.equal(character.skills.find(skill => skill.id === 'speaker')?.count, 1);

  const quest = getQuestTrail(posted.world, witnessA).find(item => item.id === 'witness-commons-message');
  assert.equal(quest.complete, true);
  assert.deepEqual(quest.evidenceIds, [event.id]);
  assert.match(quest.interpretation, /not evidence, truth, approval, authority or XP/i);
  await validateWorld(posted.world);
});

test('Commons reports are private and human moderation hides text without erasing history', async () => {
  let world = createWorld({ id: 'commons-moderation', now: at(0) });
  const posted = await post(world, witnessA, 1000, 'Retain the original, even when a human hides the public copy.');
  world = posted.world;
  const messageId = posted.result.messageId;

  const reported = await report(world, witnessB, 2000, messageId, 'privacy', 'This contains a private detail.');
  world = reported.world;
  const reportEvent = world.events.at(-1);
  assert.equal(reportEvent.type, 'message-reported');

  const unrelatedView = publicWorld(world, witnessC);
  assert.equal(unrelatedView.events.some(event => event.type === 'message-reported'), false);
  assert.equal(publicWorld(world, witnessB).events.some(event => event.type === 'message-reported'), true);
  assert.equal(publicWorld(world, founder).events.some(event => event.type === 'message-reported'), true);
  assert.equal(projectTownSquare(world, witnessC).pendingReports.length, 0);
  assert.equal(projectTownSquare(world, founder).pendingReports.length, 1);
  assert.equal(projectTownSquare(world, witnessB).messages[0].canReport, false);

  await assert.rejects(
    applyAction(world, { type: 'moderate-message', messageId, disposition: 'hide', reason: 'privacy' }, witnessA, { now: at(3000) }),
    error => error.code === 'FORBIDDEN' && error.status === 403
  );
  const hidden = await applyAction(world, { type: 'moderate-message', messageId, disposition: 'hide', reason: 'privacy' }, founder, { now: at(3000) });
  world = hidden.world;
  assert.equal(world.events.at(-1).actor.id, founder.id);
  assert.equal(projectTownSquare(world, founder).messages[0].hidden, true);
  assert.equal(projectTownSquare(world, witnessC).messages[0].text, 'This message was hidden after human review.');

  const witnessView = publicWorld(world, witnessC);
  const publicPost = witnessView.events.find(event => event.type === 'message-posted');
  assert.equal(publicPost.text, '[Message hidden by human moderation.]');
  assert.equal(witnessView.events.some(event => event.type === 'message-reported'), false);
  assert.equal(publicWorld(world, founder).events.find(event => event.type === 'message-posted').text, 'Retain the original, even when a human hides the public copy.');

  const restored = await applyAction(world, { type: 'moderate-message', messageId, disposition: 'restore', reason: 'other' }, founder, { now: at(4000) });
  assert.equal(projectTownSquare(restored.world, witnessC).messages[0].hidden, false);
  assert.equal(restored.world.events.filter(event => event.type === 'message-moderated').length, 2);
  assert.equal(restored.world.events.find(event => event.type === 'message-posted').text, 'Retain the original, even when a human hides the public copy.');
  await validateWorld(restored.world);
});

test('Commons enforces per-actor rate limits, one report per actor, and report-before-hide', async () => {
  let world = createWorld({ id: 'commons-bounds', now: at(0) });
  for (let index = 0; index < 5; index += 1) {
    world = (await post(world, witnessA, 1000 + index * 1000, 'Bounded message '+index)).world;
  }
  await assert.rejects(post(world, witnessA, 6000, 'Sixth message in one minute.'), error => error.code === 'COMMONS_RATE_LIMITED' && error.status === 429);

  const target = world.events.find(event => event.type === 'message-posted');
  await assert.rejects(report(world, witnessA, 7000, target.messageId), error => error.code === 'SELF_REPORT');
  await assert.rejects(
    applyAction(world, { type: 'moderate-message', messageId: target.messageId, disposition: 'hide', reason: 'spam' }, founder, { now: at(6500) }),
    error => error.code === 'MESSAGE_NOT_REPORTED'
  );
  const firstReport = await report(world, witnessB, 7000, target.messageId);
  await assert.rejects(report(firstReport.world, witnessB, 8000, target.messageId), error => error.code === 'MESSAGE_ALREADY_REPORTED');
  await validateWorld(firstReport.world);
});

test('device-local Commons mutes filter one viewer without changing retained history or another feed', async () => {
  let world = createWorld({ id: 'commons-local-mute', now: at(0) });
  world = (await post(world, founder, 1000, 'A public argument remains visible to the institution.')).world;
  world = (await post(world, witnessA, 2000, 'A separate contribution remains in the same Chronicle.')).world;
  const beforeEvents = structuredClone(world.events);
  const beforeRevision = world.revision;
  const beforeXp = world.xp;

  const muted = projectTownSquare(world, witnessA, {
    mutedAuthors: [{ id: founder.id, role: founder.role, name: founder.name }]
  });
  assert.equal(muted.totalMessages, 2);
  assert.equal(muted.mutedMessageCount, 1);
  assert.deepEqual(muted.mutedAuthors, [{ id: founder.id, role: founder.role, name: founder.name }]);
  assert.equal(muted.messages.some(message => message.author.id === founder.id), false);
  assert.equal(muted.messages.find(message => message.author.id === witnessA.id)?.canMute, false);

  const otherViewer = projectTownSquare(world, witnessB);
  assert.equal(otherViewer.messages.some(message => message.author.id === founder.id), true);
  assert.equal(otherViewer.messages.some(message => message.author.id === witnessA.id), true);
  assert.deepEqual(projectCommonsMessages(world, witnessA).map(message => message.text), [
    'A separate contribution remains in the same Chronicle.'
  ]);
  assert.deepEqual(world.events, beforeEvents);
  assert.equal(world.revision, beforeRevision);
  assert.equal(world.xp, beforeXp);
  await validateWorld(world);
});

test('Commons idempotency receipts bind exact post, report and moderation results', async () => {
  const original = createWorld({ id: 'commons-receipts', now: at(0) });
  const posted = await applyAction(original, { type: 'post-message', text: 'Exact retry must not duplicate this post.' }, witnessA, {
    now: at(1000), requestId: 'commons-post-001', actionFingerprint: fingerprint
  });
  assert.equal(posted.world.events[0].actionResult.messageId, posted.result.messageId);
  await validateWorld(posted.world);

  const reported = await applyAction(posted.world, { type: 'report-message', messageId: posted.result.messageId, reason: 'other', details: 'Review.' }, witnessB, {
    now: at(2000), requestId: 'commons-report-001', actionFingerprint: 'b'.repeat(64)
  });
  assert.equal(reported.world.events.at(-1).actionResult.reportId, reported.result.reportId);
  const hidden = await applyAction(reported.world, { type: 'moderate-message', messageId: posted.result.messageId, disposition: 'hide', reason: 'other' }, founder, {
    now: at(3000), requestId: 'commons-moderate-001', actionFingerprint: 'c'.repeat(64)
  });
  assert.deepEqual(hidden.world.events.at(-1).actionResult, {
    moderationId: hidden.result.moderationId, disposition: 'hide'
  });
  await validateWorld(hidden.world);

  const tampered = structuredClone(hidden.world);
  tampered.events[0].actionResult.messageId = 'different-message';
  await assert.rejects(validateWorld(tampered), error => error.code === 'INVALID_WORLD');
});

test('Commons view is bounded to the latest fifty posts while retaining older history', async () => {
  let world = createWorld({ id: 'commons-feed-bound', now: at(0) });
  for (let index = 0; index < 51; index += 1) {
    world = (await post(world, witnessA, 1000 + index * 60_001, 'Retained message '+index)).world;
  }
  const feed = projectTownSquare(world, witnessA);
  assert.equal(feed.totalMessages, 51);
  assert.equal(feed.messages.length, 50);
  assert.equal(feed.omittedMessageCount, 1);
  assert.equal(feed.messages[0].text, 'Retained message 50');
  assert.equal(world.events.filter(event => event.type === 'message-posted').length, 51);
  assert.equal(world.xp, 0);
});
