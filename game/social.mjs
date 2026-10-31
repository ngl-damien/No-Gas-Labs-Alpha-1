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
export function projectTownSquare(world, viewer) {
  const events = eventsOf(world);
  const founder = viewer?.role === 'founder';
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

  const messages = posts.slice(-50).reverse().map(({ event }) => {
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
    pendingReports,
    totalMessages: posts.length,
    omittedMessageCount: Math.max(0, posts.length - messages.length),
    pendingReportTotal: pending.length,
    omittedPendingReportCount: Math.max(0, pending.length - pendingReports.length),
    canPost: true,
    founder
  };
}
