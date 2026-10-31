export const COMMONS_CHANNEL = 'commons';
export const COMMONS_MESSAGE_LIMIT = 280;
export const COMMONS_POSTS_PER_MINUTE = 5;
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
