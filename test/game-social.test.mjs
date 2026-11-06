import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, applyAction, publicWorld, validateWorld } from '../game/model.mjs';
import { projectTownSquare, projectCommonsMessages, projectGuildFieldSatchel, COMMONS_REPORTS_PER_MINUTE, COMMONS_RATE_WINDOW_MS } from '../game/social.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';
import { sourceObservationRequestMaterial } from '../game/research-records.mjs';

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

test('Commons enforces per-actor post and report rate limits, one report per actor, and report-before-hide', async () => {
  let world = createWorld({ id: 'commons-bounds', now: at(0) });
  for (let index = 0; index < 5; index += 1) {
    world = (await post(world, witnessA, 1000 + index * 1000, 'Bounded message '+index)).world;
  }
  await assert.rejects(post(world, witnessA, 6000, 'Sixth message in one minute.'), error => error.code === 'COMMONS_RATE_LIMITED' && error.status === 429);
  world = (await post(world, witnessC, 6000, 'A sixth message from a separate actor.')).world;

  const targets = world.events.filter(event => event.type === 'message-posted');
  const target = targets[0];
  await assert.rejects(report(world, witnessA, 7000, target.messageId), error => error.code === 'SELF_REPORT');
  await assert.rejects(
    applyAction(world, { type: 'moderate-message', messageId: target.messageId, disposition: 'hide', reason: 'spam' }, founder, { now: at(6500) }),
    error => error.code === 'MESSAGE_NOT_REPORTED'
  );

  for (let index = 0; index < COMMONS_REPORTS_PER_MINUTE; index += 1) {
    world = (await report(world, witnessB, 7000 + index * 1000, targets[index].messageId)).world;
  }
  await assert.rejects(
    report(world, witnessB, 12000, targets[5].messageId),
    error => error.code === 'COMMONS_REPORT_RATE_LIMITED' && error.status === 429
  );
  await assert.rejects(
    report(world, witnessB, 13000, targets[0].messageId),
    error => error.code === 'MESSAGE_ALREADY_REPORTED'
  );
  await validateWorld(world);

  const tampered = structuredClone(world);
  tampered.events.push({
    id: 'event-over-limit-commons-report',
    type: 'message-reported',
    actor: witnessB,
    at: at(14000),
    semantics: 'Game projection only; a report is a request for human review, not a verdict.',
    reportId: 'message-report-over-limit',
    messageId: targets[5].messageId,
    reason: 'other',
    details: 'This imported history exceeds the per-actor report bound.'
  });
  tampered.revision += 1;
  tampered.updatedAt = at(14000);
  await assert.rejects(
    validateWorld(tampered),
    error => error.code === 'INVALID_WORLD' && /report rate limit/i.test(error.message)
  );

  const afterWindow = await report(world, witnessB, 7000 + COMMONS_RATE_WINDOW_MS + 1, targets[5].messageId);
  assert.equal(afterWindow.world.events.filter(event => event.type === 'message-reported' && event.actor.id === witnessB.id).length, COMMONS_REPORTS_PER_MINUTE + 1);
  await validateWorld(afterWindow.world);
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

test('Guild Hall field satchel indexes current members’ retained work, dissent and research without mutation or XP', async () => {
  let world = createWorld({ id: 'guild-field-satchel', now: at(0) });
  const draft = await applyAction(world, {
    type: 'draft', kind: 'observatory', title: 'Guild Source Observatory',
    intent: 'Preserve one source claim beside its uncertainty and falsifier.'
  }, founder, { now: at(1000) });
  const published = await applyAction(draft.world, {
    type: 'publish', draftId: draft.result.draftId, expectedVersion: 0
  }, founder, { now: at(2000) });
  world = published.world;
  const creationId = published.result.creationId;

  const created = await applyAction(world, {
    type: 'create-guild', name: 'Field Researchers',
    charter: 'Compare observations and preserve dissent.'
  }, founder, { now: at(3000) });
  world = created.world;
  const guildId = created.result.guildId;
  world = (await applyAction(world, {
    type: 'join-guild', guildId
  }, witnessA, { now: at(4000) })).world;

  const posted = await post(world, witnessA, 5000, 'The source may be stale; keep the uncertainty visible.');
  world = posted.world;
  world = (await applyAction(world, {
    type: 'contribute', creationId, version: 1,
    text: 'The publication receipt identifies bytes, not source truth.'
  }, witnessA, { now: at(6000) })).world;
  world = (await applyAction(world, {
    type: 'report', creationId, version: 1,
    text: 'Independent retrieval has not been performed.'
  }, witnessA, { now: at(7000) })).world;

  const proposal = await applyAction(world, {
    type: 'propose-moonshot',
    title: 'Can the source be independently retrieved?',
    hypothesis: 'A current primary source will support the narrow claim.',
    falsifier: 'The current primary source contradicts the claim.',
    evidenceNeeded: 'A directly retrieved source with a current timestamp.',
    sourceCreationId: creationId, sourceVersion: 1
  }, witnessA, { now: at(8000) });
  world = proposal.world;
  const experiment = await applyAction(world, {
    type: 'report-experiment', moonshotId: proposal.result.moonshotId,
    procedure: 'Attempt to retrieve the cited primary source.',
    observation: 'The source was not retrieved during this attempt.',
    reportedOutcome: 'failed', evidenceCreationId: creationId, evidenceVersion: 1
  }, founder, { now: at(9000) });
  world = experiment.world;
  world = (await applyAction(world, {
    type: 'challenge-experiment-report',
    reportId: experiment.result.reportId,
    challengeType: 'reproducibility',
    challengeText: 'The attempt record does not include a reproducible retrieval procedure.'
  }, witnessA, { now: at(10000) })).world;

  const note = {
    claim: 'The cited primary source states that the bridge is open.',
    sourceKind: 'primary-source',
    source: 'City bridge status page; retrieval not performed.',
    falsifier: 'Direct inspection finds the bridge closed.',
    uncertainty: 'The cited page may be stale.',
    nextTest: 'Retrieve the current page and compare its timestamp.'
  };
  const material = sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId, version: 1, ...note
  });
  const observationId = 'source-observation-' + createHash('sha256').update(material).digest('hex');
  world = (await applyAction(world, {
    type: 'record-source-observation', creationId, version: 1,
    observationId, ...note
  }, founder, {
    now: at(11000), requestId: observationId, actionFingerprint: 'd'.repeat(64)
  })).world;
  const sourceChallenge = await applyAction(world, {
    type: 'challenge-source-observation',
    observationId, challengeType: 'missing-evidence',
    challengeText: 'The source has not been retrieved, so its current wording is unknown.'
  }, witnessA, { now: at(12000) });
  world = sourceChallenge.world;
  world = (await applyAction(world, {
    type: 'respond-source-observation-challenge',
    challengeId: sourceChallenge.result.challengeId,
    responseText: 'Agreed. This note is a lead only; retrieval and independent verification remain outstanding.'
  }, founder, { now: at(13000) })).world;

  world = (await report(world, founder, 14000, posted.result.messageId, 'privacy', 'Review the public wording.')).world;
  world = (await applyAction(world, {
    type: 'moderate-message', messageId: posted.result.messageId,
    disposition: 'hide', reason: 'privacy'
  }, founder, { now: at(15000) })).world;

  const before = structuredClone(world);
  const founderSatchel = projectGuildFieldSatchel(world, founder);
  const witnessSatchel = projectGuildFieldSatchel(world, witnessA);
  const outsiderSatchel = projectGuildFieldSatchel(world, witnessB);

  assert.equal(founderSatchel.available, true);
  assert.equal(founderSatchel.guild.id, guildId);
  assert.equal(founderSatchel.guild.memberCount, 2);
  assert.deepEqual(witnessSatchel.items.map(item => item.eventId), founderSatchel.items.map(item => item.eventId));
  assert.equal(outsiderSatchel.guild, null);
  assert.equal(outsiderSatchel.total, 0);
  assert.ok(founderSatchel.total >= 10);

  const kinds = new Set(founderSatchel.items.map(item => item.kind));
  for (const kind of [
    'published-artifact', 'commons-message', 'field-contribution', 'dissent-report',
    'moonshot-proposal', 'experiment-report', 'experiment-challenge',
    'source-observation', 'source-observation-challenge', 'source-observation-response'
  ]) assert.ok(kinds.has(kind), 'missing guild satchel object kind: ' + kind);

  const messageItem = founderSatchel.items.find(item => item.eventId === posted.world.events.at(-1).id);
  assert.ok(messageItem);
  assert.equal(messageItem.summary, '[Message hidden by human moderation.]');
  assert.match(messageItem.status, /not evidence, approval, ownership, authority, or XP/i);
  assert.ok(founderSatchel.items.every(item => Object.isFrozen(item) && Object.isFrozen(item.action)));
  assert.deepEqual(world, before, 'opening the guild satchel must not mutate canonical history');
  assert.equal(world.xp, 100, 'only the retained publication contributes XP');

  await validateWorld(world);
  world = (await applyAction(world, {
    type: 'leave-guild', guildId
  }, witnessA, { now: at(16000) })).world;
  const afterDeparture = projectGuildFieldSatchel(world, founder);
  assert.equal(afterDeparture.guild.memberCount, 1);
  assert.equal(afterDeparture.items.some(item => item.actor.id === witnessA.id), false);
  assert.equal(afterDeparture.items.some(item => item.eventId === posted.world.events.at(-1).id), false);
  assert.equal(world.events.some(event => event.type === 'message-posted' && event.messageId === posted.result.messageId), true,
    'departure changes the current roster projection, not the retained Commons history');
  assert.equal(projectGuildFieldSatchel(world, witnessA).guild, null);
  await validateWorld(world);
});

