import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { createWorld, applyAction, publicWorld, validateWorld } from '../game/model.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';
import { COMMONS_MESSAGE_LIMIT, projectCommonsMessages, projectTownSquare, projectPlayerGuilds, PLAYER_GUILD_MEMBER_LIMIT } from '../game/social.mjs';

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

test('Commons device-local mutes hide exact actor posts only in that viewer projection and never mutate shared history', async () => {
  let world = createWorld({ now: at(0) });
  world = await act(world, { type: 'post-message', text: 'Visible to both players.' }, firstWitness, 1);
  world = await act(world, { type: 'post-message', text: 'Muted only by the first player.' }, secondWitness, 2);
  const before = structuredClone(world);

  const muted = projectTownSquare(publicWorld(world, firstWitness), firstWitness, {
    mutedAuthors: [{ id: secondWitness.id, role: secondWitness.role, name: secondWitness.name }]
  });
  assert.equal(muted.messages.length, 1);
  assert.equal(muted.messages[0].text, 'Visible to both players.');
  assert.equal(muted.messages[0].canMute, false, 'a character cannot mute itself');
  assert.equal(muted.mutedMessageCount, 1);
  assert.equal(muted.mutedAuthors.length, 1);
  assert.equal(muted.totalMessages, 2);
  assert.equal(muted.omittedMessageCount, 0);

  const otherPlayer = projectTownSquare(publicWorld(world, secondWitness), secondWitness);
  assert.equal(otherPlayer.messages.length, 2, 'another player receives the unfiltered shared feed');
  assert.equal(otherPlayer.mutedMessageCount, 0);
  assert.deepEqual(world, before, 'device-local preferences never append or mutate world events');
  assert.equal(world.xp, 0);
  await validateWorld(world);
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

test('player guilds are deterministic public event projections and never award XP or authority', async () => {
  let world = createWorld({ now: at(0) });
  const before = projectCharacter(world, firstWitness);
  const created = await applyAction(world, {
    type: 'create-guild',
    name: '  Field   Researchers  ',
    charter: '  Compare observations and challenge unsupported claims.  '
  }, firstWitness, {
    now: at(1),
    requestId: 'player-guild-create-001',
    actionFingerprint: 'a'.repeat(64)
  });
  world = created.world;
  const guildId = created.result.guildId;
  assert.equal(world.events[0].type, 'guild-created');
  assert.equal(world.events[0].name, 'Field Researchers');
  assert.equal(world.events[0].charter, 'Compare observations and challenge unsupported claims.');
  assert.equal(projectPlayerGuilds(world, firstWitness).viewerIsLeader, true);
  assert.equal(projectPlayerGuilds(publicWorld(world, secondWitness), secondWitness).guilds[0].name, 'Field Researchers');

  const joined = await applyAction(world, { type: 'join-guild', guildId }, secondWitness, {
    now: at(2),
    requestId: 'player-guild-join-001',
    actionFingerprint: 'b'.repeat(64)
  });
  world = joined.world;
  const projection = projectPlayerGuilds(publicWorld(world, secondWitness), secondWitness);
  assert.equal(projection.guilds[0].memberCount, 2);
  assert.equal(projection.viewerGuildId, guildId);
  assert.equal(projection.viewerIsLeader, false);
  assert.deepEqual(projection.guilds[0].members.map(member => member.id), [firstWitness.id, secondWitness.id]);
  assert.equal(world.xp, 0);
  assert.equal(projectCharacter(world, firstWitness).xp, before.xp);
  assert.equal(projectCharacter(world, secondWitness).xp, before.xp);
  await validateWorld(world);
});

test('player guild rules enforce one membership, unique active names, leader closure and member capacity', async () => {
  let world = createWorld({ now: at(0) });
  world = await act(world, {
    type: 'create-guild', name: 'Field Researchers', charter: 'Compare real observations.'
  }, firstWitness, 1);
  const guildId = world.events[0].guildId;

  await assert.rejects(
    act(world, { type: 'create-guild', name: 'Second Crew', charter: 'A second group.' }, firstWitness, 2),
    error => error.code === 'GUILD_MEMBERSHIP_EXISTS'
  );
  await assert.rejects(
    act(world, { type: 'create-guild', name: ' field researchers ', charter: 'Duplicate name.' }, secondWitness, 2),
    error => error.code === 'GUILD_NAME_TAKEN'
  );
  world = await act(world, { type: 'join-guild', guildId }, secondWitness, 3);
  await assert.rejects(
    act(world, { type: 'join-guild', guildId }, secondWitness, 4),
    error => error.code === 'GUILD_MEMBERSHIP_EXISTS'
  );
  await assert.rejects(
    act(world, { type: 'leave-guild', guildId }, firstWitness, 4),
    error => error.code === 'GUILD_LEADER_CANNOT_LEAVE'
  );
  await assert.rejects(
    act(world, { type: 'disband-guild', guildId }, firstWitness, 4),
    error => error.code === 'GUILD_NOT_EMPTY'
  );
  await assert.rejects(
    act(world, { type: 'disband-guild', guildId }, secondWitness, 4),
    error => error.code === 'FORBIDDEN'
  );

  world = await act(world, { type: 'leave-guild', guildId }, secondWitness, 5);
  world = await act(world, { type: 'disband-guild', guildId }, firstWitness, 6);
  const closed = projectPlayerGuilds(world, firstWitness);
  assert.equal(closed.guilds.length, 0);
  assert.equal(closed.history.length, 1);
  assert.equal(closed.history[0].status, 'disbanded');
  assert.equal(closed.history[0].memberCount, 0);
  assert.deepEqual(world.events.map(event => event.type), [
    'guild-created', 'guild-joined', 'guild-left', 'guild-disbanded'
  ]);
  await validateWorld(world);
});

test('player guild capacity is enforced at the server projection boundary', async () => {
  let world = createWorld({ now: at(0) });
  world = await act(world, { type: 'create-guild', name: 'Open Field', charter: 'A bounded roster.' }, firstWitness, 1);
  const guildId = world.events[0].guildId;
  for (let index = 0; index < PLAYER_GUILD_MEMBER_LIMIT - 1; index += 1) {
    const actor = { id: 'member-' + index, name: 'Member ' + index, role: 'witness' };
    world = await act(world, { type: 'join-guild', guildId }, actor, index + 2);
  }
  assert.equal(projectPlayerGuilds(world).guilds[0].memberCount, PLAYER_GUILD_MEMBER_LIMIT);
  await assert.rejects(
    act(world, { type: 'join-guild', guildId }, { id: 'member-overflow', name: 'Overflow', role: 'witness' }, 40),
    error => error.code === 'GUILD_MEMBER_LIMIT'
  );
  await validateWorld(world);
});

test('player guild history rejects malformed fields, unknown guilds and mismatched replay receipts', async () => {
  let world = createWorld({ now: at(0) });
  const created = await applyAction(world, {
    type: 'create-guild', name: 'Evidence Crew', charter: 'Keep claims falsifiable.'
  }, firstWitness, {
    now: at(1),
    requestId: 'guild-history-create-001',
    actionFingerprint: 'c'.repeat(64)
  });
  world = created.world;
  const joined = await applyAction(world, {
    type: 'join-guild', guildId: created.result.guildId
  }, secondWitness, {
    now: at(2),
    requestId: 'guild-history-join-001',
    actionFingerprint: 'd'.repeat(64)
  });
  world = joined.world;

  const extraField = structuredClone(world);
  extraField.events[0].untrustedApproval = true;
  await assert.rejects(validateWorld(extraField), error => error.code === 'INVALID_WORLD');

  const unknownGuild = structuredClone(world);
  unknownGuild.events[1].guildId = 'guild-missing';
  await assert.rejects(validateWorld(unknownGuild), error => error.code === 'INVALID_WORLD');

  const mismatchedReceipt = structuredClone(world);
  mismatchedReceipt.events[1].actionResult.guildId = 'guild-forged';
  await assert.rejects(validateWorld(mismatchedReceipt), error => error.code === 'INVALID_WORLD');
});

test('Commons activity projection is actor-bound, unique, bounded and retains hidden submissions', async () => {
  let world = createWorld({ now: at(0) });
  world = await act(world, { type: 'post-message', text: 'A retained Commons statement.' }, firstWitness, 1);
  const original = world.events.find(event => event.type === 'message-posted');
  assert.ok(original);
  assert.deepEqual(projectCommonsMessages(world, firstWitness).map(event => event.id), [original.id]);
  assert.deepEqual(projectCommonsMessages(world, secondWitness), []);
  assert.deepEqual(projectCommonsMessages(world, { id: firstWitness.id, role: 'founder' }), []);

  world = await act(world, {
    type: 'report-message', messageId: original.messageId, reason: 'privacy', details: 'Please review.'
  }, secondWitness, 2);
  world = await act(world, {
    type: 'moderate-message', messageId: original.messageId, disposition: 'hide', reason: 'privacy'
  }, founder, 3);
  const retained = world.events.find(event => event.type === 'message-posted');
  assert.deepEqual(projectCommonsMessages(world, firstWitness).map(event => event.id), [retained.id]);
  const hiddenPublicPost = projectCommonsMessages(publicWorld(world, firstWitness), firstWitness)[0];
  assert.equal(hiddenPublicPost.text, '[Message hidden by human moderation.]',
    'the Witness receives the redacted event while the submission remains countable');
  assert.equal(world.xp, 0);

  const duplicateEventId = {
    ...world,
    events: [...world.events, { ...retained, messageId: 'message-distinct', text: 'Different payload.' }]
  };
  assert.deepEqual(projectCommonsMessages(duplicateEventId, firstWitness), [],
    'duplicate event IDs cannot create a Commons activity object');
  const duplicateMessageId = {
    ...world,
    events: [...world.events, { ...retained, id: 'event-distinct-message' }]
  };
  assert.deepEqual(projectCommonsMessages(duplicateMessageId, firstWitness), [],
    'duplicate message IDs cannot create two activity objects');

  const malformedText = {
    ...world,
    events: [{ ...retained, id: 'event-long-message', messageId: 'message-long-message', text: 'x'.repeat(COMMONS_MESSAGE_LIMIT + 1) }]
  };
  assert.deepEqual(projectCommonsMessages(malformedText, firstWitness), []);
  const wrongChannel = {
    ...world,
    events: [{ ...retained, id: 'event-wrong-channel', messageId: 'message-wrong-channel', channel: 'town-square' }]
  };
  assert.deepEqual(projectCommonsMessages(wrongChannel, firstWitness), []);
  const invalidTime = {
    ...world,
    events: [{ ...retained, id: 'event-invalid-time', messageId: 'message-invalid-time', at: '2026-10-31' }]
  };
  assert.deepEqual(projectCommonsMessages(invalidTime, firstWitness), []);

  const beforeProjection = structuredClone(world);
  projectCommonsMessages(world, firstWitness);
  assert.deepEqual(world, beforeProjection, 'the projection is read-only');
});


test('shared Commons HTTP post completes only its actor quest and remains in the redacted satchel after moderation', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-commons-quest-http-'));
  const founderKey = 'test-founder-key-not-a-production-secret';
  let server;
  t.after(async () => {
    await server?.closeGame();
    await rm(dataDir, { recursive: true, force: true });
  });

  server = await createGameServer({ dataDir, founderKey });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    return {
      async request(path, payload) {
        const headers = cookie ? { cookie } : {};
        const options = { method: payload === undefined ? 'GET' : 'POST', headers };
        if (payload !== undefined) {
          headers['content-type'] = 'application/json';
          headers.origin = origin;
          options.body = JSON.stringify(payload);
        }
        const response = await fetch(origin + path, options);
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { response, body: await response.json() };
      }
    };
  }

  const speaker = client();
  const otherWitness = client();
  const initial = await speaker.request('/api/state');
  const otherInitial = await otherWitness.request('/api/state');
  assert.equal(initial.response.status, 200);
  assert.equal(otherInitial.response.status, 200);
  const speakerActor = initial.body.viewer;
  const otherActor = otherInitial.body.viewer;
  assert.equal(speakerActor.role, 'witness');
  assert.equal(otherActor.role, 'witness');
  assert.notEqual(speakerActor.id, otherActor.id);
  const before = projectCharacter(initial.body.world, speakerActor);

  const text = 'A real shared-world message completes its speaker quest.';
  const action = {
    type: 'post-message',
    text,
    requestId: 'commons-quest-http-acceptance-001'
  };
  const posted = await speaker.request('/api/action', action);
  assert.equal(posted.response.status, 200, JSON.stringify(posted.body));
  assert.equal(posted.body.idempotentReplay, false);
  const messageId = posted.body.result.messageId;
  const originalEvent = posted.body.world.events.find(event =>
    event.type === 'message-posted' && event.messageId === messageId
  );
  assert.ok(originalEvent);
  assert.equal(originalEvent.actor.id, speakerActor.id);
  assert.equal(originalEvent.actor.role, speakerActor.role);
  assert.equal(originalEvent.channel, 'commons');
  assert.equal(originalEvent.text, text);

  const replay = await speaker.request('/api/action', action);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.result.messageId, messageId);
  const foreignReplay = await otherWitness.request('/api/action', action);
  assert.equal(foreignReplay.response.status, 409);
  assert.equal(foreignReplay.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const otherState = await otherWitness.request('/api/state');
  const otherQuest = getQuestTrail(otherState.body.world, otherActor)
    .find(item => item.id === 'witness-commons-message');
  assert.equal(otherQuest.complete, false, 'another Witness cannot inherit the speaker quest');
  assert.deepEqual(otherQuest.action, { type: 'location', id: 'commons' });
  assert.equal(projectCharacter(otherState.body.world, otherActor)
    .skills.find(skill => skill.id === 'speaker').count, 0);

  const speakerState = await speaker.request('/api/state');
  const completed = getQuestTrail(speakerState.body.world, speakerActor)
    .find(item => item.id === 'witness-commons-message');
  assert.equal(completed.complete, true);
  assert.deepEqual(completed.evidenceIds, [originalEvent.id]);
  const speakerRecord = projectCharacter(speakerState.body.world, speakerActor);
  assert.equal(speakerRecord.skills.find(skill => skill.id === 'speaker').count, 1);
  const satchelItem = speakerRecord.fieldSatchel.find(item => item.kind === 'commons-message');
  assert.ok(satchelItem);
  assert.equal(satchelItem.eventId, originalEvent.id);
  assert.equal(satchelItem.locationId, 'commons');
  assert.deepEqual(satchelItem.action, { type: 'location', id: 'commons' });
  assert.equal(speakerRecord.xp, before.xp, 'Commons participation is not XP');
  assert.equal(speakerRecord.questXp, before.questXp, 'the Commons objective is XP-neutral');

  const report = await otherWitness.request('/api/action', {
    type: 'report-message',
    messageId,
    reason: 'privacy',
    details: 'Use a controlled fixture to exercise retained moderation.'
  });
  assert.equal(report.response.status, 200, JSON.stringify(report.body));

  const founder = client();
  const login = await founder.request('/api/login', { key: founderKey, name: 'Damien' });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  const hidden = await founder.request('/api/action', {
    type: 'moderate-message',
    messageId,
    disposition: 'hide',
    reason: 'privacy'
  });
  assert.equal(hidden.response.status, 200, JSON.stringify(hidden.body));

  const afterHide = await speaker.request('/api/state');
  const redactedEvent = afterHide.body.world.events.find(event =>
    event.type === 'message-posted' && event.messageId === messageId
  );
  assert.equal(redactedEvent.text, '[Message hidden by human moderation.]');
  const retainedQuest = getQuestTrail(afterHide.body.world, speakerActor)
    .find(item => item.id === 'witness-commons-message');
  assert.equal(retainedQuest.complete, true, 'human hiding changes visibility, not retained participation');
  assert.deepEqual(retainedQuest.evidenceIds, [originalEvent.id]);
  const redactedRecord = projectCharacter(afterHide.body.world, speakerActor);
  assert.equal(redactedRecord.xp, before.xp);
  assert.equal(redactedRecord.skills.find(skill => skill.id === 'speaker').count, 1);
  const redactedSatchelItem = redactedRecord.fieldSatchel.find(item => item.kind === 'commons-message');
  assert.ok(redactedSatchelItem);
  assert.equal(redactedSatchelItem.eventId, originalEvent.id);
  assert.equal(redactedSatchelItem.summary, '[Message hidden by human moderation.]');

  const founderState = await founder.request('/api/state');
  const founderCopy = founderState.body.world.events.find(event =>
    event.type === 'message-posted' && event.messageId === messageId
  );
  assert.equal(founderCopy.text, text, 'Founder history retains the original text for human review');
});
