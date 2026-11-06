import { isStrictTimestamp } from './timestamps.mjs';
import { projectResearchRecords, projectSourceObservationRecords } from './research-records.mjs';

export const COMMONS_CHANNEL = 'commons';
export const COMMONS_MESSAGE_LIMIT = 280;
export const COMMONS_POSTS_PER_MINUTE = 5;
export const COMMONS_REPORTS_PER_MINUTE = 5;
export const COMMONS_RATE_WINDOW_MS = 60_000;
export const COMMONS_REASONS = Object.freeze(['spam', 'harassment', 'privacy', 'other']);
export const COMMONS_DISPOSITIONS = Object.freeze(['hide', 'restore']);

function eventsOf(world) {
  return Array.isArray(world?.events) ? world.events : [];
}

function latestModerationRecords(world) {
  const latest = new Map();
  const events = eventsOf(world);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type === 'message-moderated' && typeof event.messageId === 'string') {
      latest.set(event.messageId, { event, index });
    }
  }
  return latest;
}

/** Return IDs currently hidden by a retained human moderation event. */
export function hiddenCommonsMessageIds(world) {
  return new Set(
    [...latestModerationRecords(world)]
      .filter(([, record]) => record.event.disposition === 'hide')
      .map(([messageId]) => messageId)
  );
}

/**
 * A bounded, read-only projection of the append-only Commons history.
 * Posts are conversation, not evidence, approval, authority, XP, or verified work.
 * Reports are visible only to their author and the authenticated Founder.
 */
function commonsActorKey(actor) {
  return actor && typeof actor.id === 'string' && actor.id &&
    ['founder', 'witness'].includes(actor.role)
    ? JSON.stringify([actor.id, actor.role])
    : null;
}

const COMMONS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMONS_FORBIDDEN_IDS = new Set(['constructor', 'prototype', '__proto__']);

function validCommonsProjectionId(value) {
  return typeof value === 'string' && COMMONS_ID_PATTERN.test(value) &&
    !COMMONS_FORBIDDEN_IDS.has(value);
}

/**
 * Project one actor's durable Commons submissions from the event log.
 * A hidden post remains a retained submission; it is still not evidence,
 * truth, approval, authority, or XP.
 */
export function projectCommonsMessages(world, viewer) {
  const viewerKey = commonsActorKey(viewer);
  if (!viewerKey || !validCommonsProjectionId(viewer.id)) return Object.freeze([]);
  const events = eventsOf(world);
  const eventIdCounts = new Map();
  const messageIdCounts = new Map();
  for (const event of events) {
    if (typeof event?.id === 'string') {
      eventIdCounts.set(event.id, (eventIdCounts.get(event.id) || 0) + 1);
    }
    if (event?.type === 'message-posted' && typeof event.messageId === 'string') {
      messageIdCounts.set(event.messageId, (messageIdCounts.get(event.messageId) || 0) + 1);
    }
  }
  const messages = events.filter(event =>
    event?.type === 'message-posted' &&
    validCommonsProjectionId(event.id) && eventIdCounts.get(event.id) === 1 &&
    validCommonsProjectionId(event.messageId) && messageIdCounts.get(event.messageId) === 1 &&
    event.channel === COMMONS_CHANNEL &&
    validCommonsProjectionId(event.actor?.id) &&
    commonsActorKey(event.actor) === viewerKey &&
    isStrictTimestamp(event.at) &&
    typeof event.text === 'string' && event.text === event.text.trim() &&
    event.text.length > 0 && Array.from(event.text).length <= COMMONS_MESSAGE_LIMIT
  );
  return Object.freeze(messages);
}

function normalizeMutedAuthors(value, viewer) {
  if (!Array.isArray(value)) return [];
  const viewerKey = commonsActorKey(viewer);
  const seen = new Set();
  const result = [];
  for (const candidate of value.slice(0, 100)) {
    if (!candidate || typeof candidate.id !== 'string' || !candidate.id.trim() ||
        Array.from(candidate.id).length > 128 ||
        !['founder', 'witness'].includes(candidate.role) ||
        typeof candidate.name !== 'string' || !candidate.name.trim() ||
        Array.from(candidate.name).length > 80) continue;
    const key = JSON.stringify([candidate.id, candidate.role]);
    if (key === viewerKey || seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({
      id: candidate.id, role: candidate.role, name: candidate.name
    }));
  }
  return result;
}

/**
 * A bounded, read-only projection of the append-only Commons history.
 * Posts are conversation, not evidence, approval, authority, XP, or verified work.
 * Reports are visible only to their author and the authenticated Founder.
 * Device-local mutes filter only this viewer's presentation; they never mutate
 * shared history, suppress another player's feed, or create a world event.
 */
export function projectTownSquare(world, viewer, options = {}) {
  const events = eventsOf(world);
  const founder = viewer?.role === 'founder';
  const viewerKey = commonsActorKey(viewer);
  const mutedAuthors = normalizeMutedAuthors(options?.mutedAuthors, viewer);
  const mutedKeys = new Set(mutedAuthors.map(commonsActorKey));
  const latest = latestModerationRecords(world);
  const posts = [];
  const postsById = new Map();
  const reportsByMessage = new Map();
  const reports = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type === 'message-posted' && typeof event.messageId === 'string') {
      const record = { event, index };
      posts.push(record);
      postsById.set(event.messageId, record);
    } else if (event?.type === 'message-reported' &&
      (founder || event.actor?.id === viewer?.id)) {
      const record = { event, index };
      reports.push(record);
      const list = reportsByMessage.get(event.messageId) || [];
      list.push(record);
      reportsByMessage.set(event.messageId, list);
    }
  }

  const recentPosts = posts.slice(-50).reverse();
  const mutedMessageCount = recentPosts.filter(({ event }) =>
    mutedKeys.has(commonsActorKey(event.actor))
  ).length;
  const messages = recentPosts
    .filter(({ event }) => !mutedKeys.has(commonsActorKey(event.actor)))
    .map(({ event }) => {
      const authorKey = commonsActorKey(event.actor);
      const moderation = latest.get(event.messageId);
      const hidden = moderation?.event.disposition === 'hide';
      const messageReports = reportsByMessage.get(event.messageId) || [];
      const lastModerationIndex = moderation?.index ?? -1;
      const pendingReportCount = founder
        ? messageReports.filter(report => report.index > lastModerationIndex).length
        : 0;
      const reportedByMe = messageReports.some(report => report.event.actor?.id === viewer?.id);
      return {
        messageId: event.messageId,
        eventId: event.id,
        text: hidden && !founder
          ? 'This message was hidden after human review.'
          : event.text,
        hidden,
        author: {
          id: event.actor?.id ?? '',
          name: event.actor?.name ?? 'Unknown actor',
          role: event.actor?.role ?? 'unknown'
        },
        at: event.at,
        reportCount: founder ? messageReports.length : 0,
        pendingReportCount,
        canReport: !hidden && event.actor?.id !== viewer?.id && !reportedByMe,
        canMute: !hidden && Boolean(authorKey) && authorKey !== viewerKey &&
          !mutedKeys.has(authorKey),
        moderationReason: moderation?.event.reason ?? null
      };
    });

  const pending = founder ? reports.filter(report => {
    const moderation = latest.get(report.event.messageId);
    return report.index > (moderation?.index ?? -1);
  }).sort((a, b) => b.index - a.index) : [];
  const pendingReports = pending.slice(0, 100).map(({ event }) => {
    const post = postsById.get(event.messageId)?.event;
    return {
      reportId: event.reportId,
      messageId: event.messageId,
      reason: event.reason,
      details: event.details,
      at: event.at,
      reporter: {
        id: event.actor?.id ?? '',
        name: event.actor?.name ?? 'Unknown actor',
        role: event.actor?.role ?? 'unknown'
      },
      messageText: post?.text ?? '[Original message unavailable]',
      messageAuthor: {
        id: post?.actor?.id ?? '',
        name: post?.actor?.name ?? 'Unknown actor',
        role: post?.actor?.role ?? 'unknown'
      }
    };
  });

  return {
    messages,
    mutedAuthors,
    mutedMessageCount,
    pendingReports,
    totalMessages: posts.length,
    omittedMessageCount: Math.max(0, posts.length - recentPosts.length),
    pendingReportTotal: pending.length,
    omittedPendingReportCount: Math.max(0, pending.length - pendingReports.length),
    canPost: true,
    founder
  };
}

export const PLAYER_GUILD_NAME_LIMIT = 32;
export const PLAYER_GUILD_CHARTER_LIMIT = 240;
export const PLAYER_GUILD_MEMBER_LIMIT = 25;
export const PLAYER_GUILD_LIMIT = 25;

const PLAYER_GUILD_EVENT_TYPES = new Set([
  'guild-created', 'guild-joined', 'guild-left', 'guild-disbanded'
]);
const PLAYER_GUILD_COMMON_FIELDS = ['id', 'type', 'actor', 'at', 'semantics'];
const PLAYER_GUILD_RECEIPT_FIELDS = ['requestId', 'actionFingerprint', 'actionResult'];
const PLAYER_GUILD_EVENT_FIELDS = Object.freeze({
  'guild-created': new Set([
    ...PLAYER_GUILD_COMMON_FIELDS, 'guildId', 'name', 'charter', ...PLAYER_GUILD_RECEIPT_FIELDS
  ]),
  'guild-joined': new Set([
    ...PLAYER_GUILD_COMMON_FIELDS, 'guildId', ...PLAYER_GUILD_RECEIPT_FIELDS
  ]),
  'guild-left': new Set([
    ...PLAYER_GUILD_COMMON_FIELDS, 'guildId', ...PLAYER_GUILD_RECEIPT_FIELDS
  ]),
  'guild-disbanded': new Set([
    ...PLAYER_GUILD_COMMON_FIELDS, 'guildId', ...PLAYER_GUILD_RECEIPT_FIELDS
  ])
});
const PLAYER_GUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PLAYER_GUILD_FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizePlayerGuildName(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function playerGuildNameKey(value) {
  return normalizePlayerGuildName(value).toLowerCase();
}

function playerGuildActorKey(actor) {
  if (!actor || typeof actor.id !== 'string' || !actor.id ||
      !['founder', 'witness'].includes(actor.role) ||
      typeof actor.name !== 'string' || !actor.name.trim() ||
      Array.from(actor.name).length > 80) {
    throw new Error('Malformed player-guild actor.');
  }
  return JSON.stringify([actor.id, actor.role]);
}

/**
 * Replay the public, append-only player-guild history.
 * Membership is a session-actor relationship, not proof of distinct humans,
 * institutional authority, verified work, XP, item ownership or approval.
 */
export function projectPlayerGuilds(world, viewer = null) {
  const guilds = new Map();
  const activeNames = new Map();
  const memberships = new Map();

  for (const event of eventsOf(world)) {
    if (!PLAYER_GUILD_EVENT_TYPES.has(event?.type)) continue;
    const allowed = PLAYER_GUILD_EVENT_FIELDS[event.type];
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        Object.keys(event).some(key => !allowed.has(key))) {
      throw new Error('Player-guild event contains unsupported fields.');
    }
    if (typeof event.guildId !== 'string' ||
        !PLAYER_GUILD_ID_PATTERN.test(event.guildId) ||
        PLAYER_GUILD_FORBIDDEN_IDS.has(event.guildId)) {
      throw new Error('Player-guild ID is malformed.');
    }

    const actorKey = playerGuildActorKey(event.actor);
    if (event.type === 'guild-created') {
      const name = normalizePlayerGuildName(event.name);
      const nameKey = playerGuildNameKey(name);
      const charter = typeof event.charter === 'string' ? event.charter.trim() : '';
      if (guilds.has(event.guildId) || !name || name !== event.name ||
          Array.from(name).length > PLAYER_GUILD_NAME_LIMIT ||
          !charter || charter !== event.charter ||
          Array.from(charter).length > PLAYER_GUILD_CHARTER_LIMIT ||
          memberships.has(actorKey) || activeNames.has(nameKey) ||
          [...guilds.values()].filter(guild => guild.status === 'active').length >= PLAYER_GUILD_LIMIT) {
        throw new Error('Player-guild creation violates the retained membership rules.');
      }
      const guild = {
        id: event.guildId,
        name,
        nameKey,
        charter,
        leader: { id: event.actor.id, name: event.actor.name, role: event.actor.role },
        leaderKey: actorKey,
        members: new Map(),
        status: 'active',
        createdAt: event.at,
        updatedAt: event.at,
        disbandedAt: null
      };
      guild.members.set(actorKey, {
        id: event.actor.id, name: event.actor.name, role: event.actor.role, joinedAt: event.at
      });
      guilds.set(guild.id, guild);
      activeNames.set(nameKey, guild.id);
      memberships.set(actorKey, guild.id);
      continue;
    }

    const guild = guilds.get(event.guildId);
    if (!guild || guild.status !== 'active') {
      throw new Error('Player-guild event references no active guild.');
    }
    if (event.type === 'guild-joined') {
      if (memberships.has(actorKey) || guild.members.has(actorKey)) {
        throw new Error('Player-guild actor already has an active membership.');
      }
      if (guild.members.size >= PLAYER_GUILD_MEMBER_LIMIT) {
        throw new Error('Player-guild member limit was exceeded.');
      }
      guild.members.set(actorKey, {
        id: event.actor.id, name: event.actor.name, role: event.actor.role, joinedAt: event.at
      });
      memberships.set(actorKey, guild.id);
    } else if (event.type === 'guild-left') {
      if (!guild.members.has(actorKey) || actorKey === guild.leaderKey) {
        throw new Error('Player-guild departure is not permitted by the retained roster.');
      }
      guild.members.delete(actorKey);
      memberships.delete(actorKey);
    } else if (event.type === 'guild-disbanded') {
      if (actorKey !== guild.leaderKey || guild.members.size !== 1 || !guild.members.has(actorKey)) {
        throw new Error('Only a sole-member guild leader may disband the guild.');
      }
      guild.members.delete(actorKey);
      memberships.delete(actorKey);
      guild.status = 'disbanded';
      guild.disbandedAt = event.at;
      activeNames.delete(guild.nameKey);
    }
    guild.updatedAt = event.at;
  }

  const serialize = guild => {
    const members = [...guild.members.values()]
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) ||
        a.id.localeCompare(b.id) || a.role.localeCompare(b.role))
      .map(member => Object.freeze({ ...member }));
    return Object.freeze({
      id: guild.id,
      name: guild.name,
      charter: guild.charter,
      leader: Object.freeze({ ...guild.leader }),
      members: Object.freeze(members),
      memberCount: members.length,
      status: guild.status,
      createdAt: guild.createdAt,
      updatedAt: guild.updatedAt,
      disbandedAt: guild.disbandedAt
    });
  };
  const history = [...guilds.values()].map(serialize);
  const active = history.filter(guild => guild.status === 'active');
  const viewerKey = viewer ? playerGuildActorKey(viewer) : null;
  const viewerGuildId = viewerKey ? memberships.get(viewerKey) || null : null;
  const viewerGuild = active.find(guild => guild.id === viewerGuildId) || null;

  return Object.freeze({
    guilds: Object.freeze(active),
    history: Object.freeze(history),
    viewerGuildId,
    viewerIsLeader: Boolean(viewerGuild && viewerKey === playerGuildActorKey(viewerGuild.leader)),
    memberLimit: PLAYER_GUILD_MEMBER_LIMIT,
    guildLimit: PLAYER_GUILD_LIMIT
  });
}

const MAX_GUILD_FIELD_ITEMS = 100;
const GUILD_FIELD_COLLABORATOR_ROLES = new Set(['archivist', 'adversary', 'synthesizer', 'tutor']);
const GUILD_FIELD_MEMBERSHIP_TYPES = new Set([
  'guild-created', 'guild-joined', 'guild-left', 'guild-disbanded'
]);

function boundedGuildFieldText(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return Array.from(value.trim()).slice(0, max).join('');
}

/**
 * Read-only index of public retained work by a guild's current members.
 * It grants no item ownership, XP, evidence status, approval, or authority.
 */
export function projectGuildFieldSatchel(world, viewer) {
  const empty = (available, guild = null) => Object.freeze({
    available, guild, total: 0, omittedCount: 0, items: Object.freeze([])
  });
  const source = eventsOf(world);
  const eventIdCounts = new Map();
  for (const event of source) {
    if (typeof event?.id === 'string' && event.id) {
      eventIdCounts.set(event.id, (eventIdCounts.get(event.id) || 0) + 1);
    }
  }
  const events = source.filter(event =>
    typeof event?.id === 'string' && event.id && eventIdCounts.get(event.id) === 1
  );
  const positionById = new Map(events.map((event, index) => [event.id, index]));
  for (const event of source) {
    if (GUILD_FIELD_MEMBERSHIP_TYPES.has(event?.type) &&
        (typeof event.id !== 'string' || eventIdCounts.get(event.id) !== 1 ||
         !isStrictTimestamp(event.at))) return empty(false);
  }

  let projection;
  try { projection = projectPlayerGuilds(world, viewer); }
  catch { return empty(false); }
  const guild = projection.guilds.find(item => item.id === projection.viewerGuildId);
  if (!guild) return empty(true);

  const members = new Map(guild.members.map(member => [
    JSON.stringify([member.id, member.role]), member
  ]));
  const hidden = hiddenCommonsMessageIds(world);
  const items = [];
  const seen = new Set();
  const add = (event, kind, title, summary, locationId, action) => {
    if (!event || typeof event.id !== 'string' || eventIdCounts.get(event.id) !== 1 ||
        seen.has(event.id) || !isStrictTimestamp(event.at)) return;
    const member = members.get(JSON.stringify([event.actor?.id, event.actor?.role]));
    const position = positionById.get(event.id);
    const safeTitle = boundedGuildFieldText(title, 120);
    const safeSummary = boundedGuildFieldText(summary, 1000);
    if (!member || !Number.isInteger(position) || !safeTitle || !safeSummary ||
        !action || typeof action !== 'object') return;
    seen.add(event.id);
    items.push({
      position,
      item: Object.freeze({
        id: 'guild-field:' + event.id,
        eventId: event.id,
        kind,
        title: safeTitle,
        summary: safeSummary,
        at: event.at,
        actor: Object.freeze({
          id: member.id,
          name: typeof event.actor?.name === 'string' && event.actor.name.trim()
            ? event.actor.name : member.name,
          role: member.role
        }),
        locationId,
        status: 'retained · not evidence, approval, ownership, authority, or XP',
        action: Object.freeze({ ...action })
      })
    });
  };

  // Publication entries require one unique retained version and matching time.
  const versionRows = new Map();
  for (const creation of Array.isArray(world?.creations) ? world.creations : []) {
    if (!creation || typeof creation.id !== 'string' || !creation.id) continue;
    for (const version of [...(Array.isArray(creation.versions) ? creation.versions : []), creation]) {
      if (!version || version.id !== creation.id || !Number.isSafeInteger(version.version) ||
          version.version < 1 || !isStrictTimestamp(version.publishedAt) ||
          version.receipt?.algorithm !== 'sha256' ||
          typeof version.receipt.digest !== 'string' || !/^[a-f0-9]{64}$/.test(version.receipt.digest) ||
          !Number.isSafeInteger(version.receipt.size) || version.receipt.size < 0) continue;
      const key = JSON.stringify([creation.id, version.version]);
      const rowsForVersion = versionRows.get(key) || [];
      rowsForVersion.push(version);
      versionRows.set(key, rowsForVersion);
    }
  }
  const publicationRows = new Map();
  for (const event of events) {
    if (event.type !== 'publish' || typeof event.creationId !== 'string' ||
        !Number.isSafeInteger(event.version) || event.version < 1 ||
        event.actor?.role !== 'founder') continue;
    const key = JSON.stringify([event.creationId, event.version]);
    const rowsForVersion = publicationRows.get(key) || [];
    rowsForVersion.push(event);
    publicationRows.set(key, rowsForVersion);
  }
  const publicationByVersion = new Map();
  for (const [key, rowsForVersion] of publicationRows) {
    const versions = versionRows.get(key) || [];
    if (rowsForVersion.length !== 1 || versions.length !== 1 ||
        rowsForVersion[0].at !== versions[0].publishedAt) continue;
    const event = rowsForVersion[0], version = versions[0];
    publicationByVersion.set(key, event);
    add(event, 'published-artifact',
      (version.title || event.creationId) + ' · v' + event.version,
      'Published artifact. Its byte receipt does not establish the truth of its contents.',
      'publication-house',
      { type: 'creation', creationId: event.creationId, version: event.version });
  }

  // Commons messages are public conversation. Human-hidden text stays redacted.
  for (const member of guild.members) {
    for (const event of projectCommonsMessages(world, member)) {
      add(event, 'commons-message', 'Commons message',
        hidden.has(event.messageId) ? '[Message hidden by human moderation.]' : event.text,
        'town-square', { type: 'commons' });
    }
  }

  // Contributions and dissent reports must join one exact event to one earlier
  // publication by the same actor. Ambiguous or orphaned text is not displayed.
  const projectTextRecords = (type, records) => {
    const recordGroups = new Map(), eventGroups = new Map();
    const keyOf = entry => JSON.stringify([
      entry?.actor?.id, entry?.actor?.role, entry?.at, entry?.creationId, entry?.version
    ]);
    for (const record of Array.isArray(records) ? records : []) {
      const key = keyOf(record);
      const group = recordGroups.get(key) || [];
      group.push(record);
      recordGroups.set(key, group);
    }
    for (const event of events) {
      if (event.type !== type) continue;
      const key = keyOf(event);
      const group = eventGroups.get(key) || [];
      group.push(event);
      eventGroups.set(key, group);
    }
    for (const [key, recordGroup] of recordGroups) {
      const eventGroup = eventGroups.get(key) || [];
      if (recordGroup.length !== 1 || eventGroup.length !== 1) continue;
      const record = recordGroup[0], event = eventGroup[0];
      const publication = publicationByVersion.get(JSON.stringify([record.creationId, record.version]));
      if (!publication || (positionById.get(event.id) ?? -1) <= (positionById.get(publication.id) ?? -1) ||
          !isStrictTimestamp(record.at) || Date.parse(publication.at) > Date.parse(record.at) ||
          typeof record.text !== 'string' || !record.text.trim()) continue;
      add(event, type === 'report' ? 'dissent-report' : 'field-contribution',
        type === 'report' ? 'Dissent or failure report' : 'Field contribution',
        record.text, 'evidence-archive',
        { type: 'creation', creationId: record.creationId, version: record.version });
    }
  };
  projectTextRecords('contribute', world?.contributions);
  projectTextRecords('report', world?.reports);

  // Research links are structural only; attempts and challenges are never promoted
  // to execution, independent observation, adjudication, or successful results.
  for (const record of projectResearchRecords(source, world?.creations)) {
    const status = record._projection || {};
    if (record.type === 'moonshot-proposed' && status.recordSafe === true &&
        status.eventIdUnique === true && status.proposalStatus === 'unique') {
      add(record, 'moonshot-proposal', 'Moonshot · ' + record.title,
        'Hypothesis: ' + record.hypothesis + ' · Falsifier: ' + record.falsifier + ' · proposal only.',
        'moonshot-field', { type: 'moonshot', moonshotId: record.moonshotId });
    } else if (record.type === 'experiment-reported' && status.recordSafe === true &&
        status.eventIdUnique === true && status.proposalStatus === 'linked') {
      add(record, 'experiment-report', 'Experiment report · ' + record.reportedOutcome,
        'Procedure: ' + record.procedure + ' · Observation: ' + record.observation +
          ' · self-reported · artifact link: ' + status.evidenceStatus + '.',
        'moonshot-field', { type: 'moonshot', moonshotId: record.moonshotId });
    } else if (record.type === 'experiment-challenged' && status.recordSafe === true &&
        status.eventIdUnique === true && status.targetReportStatus === 'linked') {
      add(record, 'experiment-challenge', 'Research challenge · ' + record.challengeType,
        record.challengeText + ' · preserved dissent, not adjudication.',
        'moonshot-field', { type: 'moonshot', moonshotId: record.moonshotId });
    }
  }

  // Linked source notes, challenges, and author replies remain distinct history items.
  for (const record of projectSourceObservationRecords(source, world?.creations)) {
    if (record.projectionStatus !== 'linked') continue;
    const action = { type: 'creation', creationId: record.creationId, version: record.version };
    add(record, 'source-observation', 'Source observation · ' + record.claim,
      'Source class: ' + record.sourceKind + ' · retrieval: ' + record.sourceRetrieval +
        ' · independent verification: ' + record.independentVerification +
        ' · model assertions: ' + record.modelAssertions + ' · ' + record.warning,
      'evidence-archive', action);
    for (const challenge of record.challenges || []) {
      add(challenge, 'source-observation-challenge', 'Source challenge · ' + challenge.challengeType,
        challenge.challengeText + ' · preserved dissent, not adjudication.',
        'evidence-archive', action);
      for (const response of challenge.responses || []) {
        add(response, 'source-observation-response', 'Author response to retained challenge',
          response.responseText + ' · attributed reply, not a verdict.',
          'evidence-archive', action);
      }
    }
  }

  // External collaborator output is indexed only as untrusted archived material.
  const responseCounts = new Map();
  for (const event of source) {
    if (event?.type === 'collaborator-response-recorded' && typeof event.responseId === 'string') {
      responseCounts.set(event.responseId, (responseCounts.get(event.responseId) || 0) + 1);
    }
  }
  const validReceipt = receipt => receipt?.algorithm === 'sha256' &&
    typeof receipt.digest === 'string' && /^[a-f0-9]{64}$/.test(receipt.digest) &&
    Number.isSafeInteger(receipt.size) && receipt.size >= 0;
  for (const event of events) {
    if (event.type !== 'collaborator-response-recorded' ||
        responseCounts.get(event.responseId) !== 1 ||
        !GUILD_FIELD_COLLABORATOR_ROLES.has(event.role) ||
        !['valid-for-human-review', 'rejected'].includes(event.validationStatus) ||
        event.validator !== 'ngl.collaborator-response.v1' ||
        !validReceipt(event.packetReceipt) || !validReceipt(event.responseReceipt)) continue;
    add(event, 'collaborator-response', event.role + ' response · ' + event.validationStatus,
      event.validationStatus === 'valid-for-human-review'
        ? 'External output was structurally validated for human review only. No claim, evidence, execution, approval, or authority was verified.'
        : 'Rejected external output remains preserved as untrusted history. Inspect the exact packet and response in the Evidence Archive.',
      'evidence-archive', { type: 'archive' });
  }

  items.sort((left, right) => right.position - left.position ||
    left.item.eventId.localeCompare(right.item.eventId));
  const total = items.length;
  return Object.freeze({
    available: true,
    guild: Object.freeze({ id: guild.id, name: guild.name, memberCount: guild.memberCount }),
    total,
    omittedCount: Math.max(0, total - MAX_GUILD_FIELD_ITEMS),
    items: Object.freeze(items.slice(0, MAX_GUILD_FIELD_ITEMS).map(entry => entry.item))
  });
}

