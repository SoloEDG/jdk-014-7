import type {
  ReviewReply,
  ReviewStatus,
  ReviewThread,
  StatusEvent,
  AnchorRevision,
} from "../model/review";

export interface ThreadMergeResult {
  thread: ReviewThread;
  addedReplies: number;
  addedRevisions: number;
  keptResolved: boolean;
}

function isResolved(status: ReviewStatus) {
  return status === "resolved";
}

/** 时间新者胜；同一毫秒内“已解决”优先于“未解决”，再按事件 id 稳定决胜。 */
function laterStatus(a: StatusEvent, b: StatusEvent): StatusEvent {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (a.status !== b.status) return isResolved(a.status) ? a : b;
  return a.id >= b.id ? a : b;
}

function mergeReplies(local: ReviewReply[], incoming: ReviewReply[]) {
  const ids = new Set(local.map((r) => r.id)),
    contents = new Set(local.map(replyFingerprint));
  const added = incoming.filter((reply) => {
    const key = replyFingerprint(reply);
    if (ids.has(reply.id) || contents.has(key)) return false;
    ids.add(reply.id);
    contents.add(key);
    return true;
  });
  return {
    replies: [...local, ...added].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    ),
    added: added.length,
  };
}

function replyFingerprint(reply: ReviewReply) {
  return `${reply.author}\u0000${reply.createdAt}\u0000${reply.body}`;
}

function mergeRevisions(local: AnchorRevision[], incoming: AnchorRevision[]) {
  const ids = new Set(local.map((r) => r.id));
  const added = incoming.filter((r) => !ids.has(r.id));
  return {
    revisions: [...local, ...added].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    ),
    added: added.length,
  };
}

/**
 * 状态是一串只增不减的事件。交换文件若无 statusLog（更早版本），
 * 用它的 status/statusAt 合成一条事件，从而仍可比较先后。
 */
function statusEvents(thread: ReviewThread): StatusEvent[] {
  if (thread.statusLog?.length) return thread.statusLog;
  return [
    {
      id: `${thread.id}-legacy-${thread.statusAt}`,
      status: thread.status,
      author: thread.author,
      at: thread.statusAt,
    },
  ];
}

function resolveStatus(local: ReviewThread, incoming: ReviewThread) {
  const byId = new Map<string, StatusEvent>();
  for (const event of [...statusEvents(local), ...statusEvents(incoming)])
    byId.set(event.id, event);
  const log = [...byId.values()].sort(
    (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  );
  if (!log.length)
    log.push({
      id: `${local.id}-fallback`,
      status: local.status,
      author: local.author,
      at: local.statusAt,
    });
  const latest = log.reduce(laterStatus);
  return { log, latest };
}

/**
 * 以事件为单位合并，而不是按“最后保存时间”整体覆盖。
 * - 回复、定位修订按 id 去重后取并集，离线回复不会丢。
 * - 状态由带时间戳的事件决定，旧文件里的“未解决”不会覆盖较新的“已解决”。
 * - originalAnchor 永远保留；anchor 只前进到更新的定位修订。
 */
export function mergeThread(
  local: ReviewThread,
  incoming: ReviewThread,
): ThreadMergeResult {
  const replies = mergeReplies(local.replies, incoming.replies),
    revisions = mergeRevisions(local.revisions, incoming.revisions),
    { log, latest } = resolveStatus(local, incoming);
  return {
    thread: {
      ...local,
      originalAnchor:
        local.originalAnchor.createdAt <= incoming.originalAnchor.createdAt
          ? local.originalAnchor
          : incoming.originalAnchor,
      anchor:
        incoming.anchor.createdAt > local.anchor.createdAt
          ? incoming.anchor
          : local.anchor,
      revisions: revisions.revisions,
      replies: replies.replies,
      status: latest.status,
      statusAt: latest.at,
      statusLog: log,
    },
    addedReplies: replies.added,
    addedRevisions: revisions.added,
    keptResolved:
      local.status === "resolved" &&
      incoming.status === "open" &&
      latest.status === "resolved",
  };
}

export interface MergeSummary {
  incomingThreads: number;
  addedThreads: number;
  addedReplies: number;
  addedRevisions: number;
  duplicatesIgnored: number;
  resolvedKeptOverStaleOpen: number;
}

/** 合并整个作品的所有讨论。返回新数组，不修改入参。 */
export function mergeThreads(
  local: ReviewThread[],
  incoming: ReviewThread[],
): { threads: ReviewThread[]; summary: MergeSummary } {
  const byId = new Map(local.map((thread) => [thread.id, thread]));
  const fingerprints = new Set(local.map(threadFingerprint));
  const summary: MergeSummary = {
    incomingThreads: incoming.length,
    addedThreads: 0,
    addedReplies: 0,
    addedRevisions: 0,
    duplicatesIgnored: 0,
    resolvedKeptOverStaleOpen: 0,
  };
  const result = [...local];
  for (const candidate of incoming) {
    if (!candidate?.id || !candidate.originalAnchor?.pageId) continue;
    const index = result.findIndex((t) => t.id === candidate.id);
    if (index >= 0) {
      const merged = mergeThread(result[index]!, candidate);
      result[index] = merged.thread;
      summary.addedReplies += merged.addedReplies;
      summary.addedRevisions += merged.addedRevisions;
      if (merged.keptResolved) summary.resolvedKeptOverStaleOpen++;
      continue;
    }
    // 同一批注可能经由不同渠道再次交换：id 不同但内容相同，仍算重复。
    const key = threadFingerprint(candidate);
    if (fingerprints.has(key)) {
      summary.duplicatesIgnored++;
      continue;
    }
    fingerprints.add(key);
    byId.set(candidate.id, candidate);
    result.push(candidate);
    summary.addedThreads++;
  }
  return { threads: result, summary };
}

function threadFingerprint(thread: ReviewThread) {
  const anchor = thread.originalAnchor,
    q = (v: number) => Math.round(v * 10000);
  return [
    thread.documentId,
    anchor.pageId,
    anchor.panelId,
    q(anchor.rect.x),
    q(anchor.rect.y),
    q(anchor.rect.width),
    q(anchor.rect.height),
    thread.author,
    thread.body,
  ].join("\u0000");
}
