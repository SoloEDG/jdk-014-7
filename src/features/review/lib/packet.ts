import type { ReviewThread } from "../model/review";
import { MAX_PACKET_BYTES, MIN_PACKET_BYTES } from "../model/review";

export interface PacketOmission {
  replies: number;
  revisions: number;
  statusEvents: number;
  firstOmittedAt?: number;
  lastOmittedAt?: number;
}

export type PacketThread = ReviewThread & { omitted?: PacketOmission };

export interface PacketReport {
  limited: boolean;
  limitBytes: number;
  /** 实际写出的字节数。 */
  bytes: number;
  totalThreads: number;
  includedThreads: number;
  omittedThreads: number;
  omittedReplies: number;
  omittedRevisions: number;
  omittedStatusEvents: number;
  omittedThreadIds: string[];
  /** 被省略事件的时间范围，用于向对方解释截断范围。 */
  omittedFrom: number | null;
  omittedTo: number | null;
  notes: string[];
}

export interface ReviewPacket {
  kind: "panel-review-packet";
  version: 1;
  documentId: string;
  documentTitle: string;
  exportedAt: number;
  exporter: string;
  threads: PacketThread[];
  report: PacketReport;
}

export interface PacketMeta {
  documentId: string;
  documentTitle: string;
  exporter: string;
  exportedAt?: number;
}

interface OptionalEvent {
  threadIndex: number;
  at: number;
  /** 同一时间戳内的稳定顺序，越靠后越新。 */
  order: number;
  apply: (thread: PacketThread) => void;
}

const encoder = new TextEncoder();
const bytesOf = (value: string) => encoder.encode(value).length;

function latestStatusId(thread: ReviewThread) {
  const sorted = [...thread.statusLog].sort(
    (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  );
  return (
    sorted[sorted.length - 1]?.id ?? `${thread.id}-legacy-${thread.statusAt}`
  );
}

/** 必留部分：正文、原始圈选、当前定位与最新状态。 */
function baseThread(thread: ReviewThread): PacketThread {
  const latest = latestStatusId(thread);
  return {
    ...thread,
    replies: [],
    revisions: [],
    statusLog: thread.statusLog.filter((event) => event.id === latest),
  };
}

function optionalEvents(threads: ReviewThread[]): OptionalEvent[] {
  const events: OptionalEvent[] = [];
  let order = 0;
  threads.forEach((thread, threadIndex) => {
    for (const reply of thread.replies)
      events.push({
        threadIndex,
        at: reply.createdAt,
        order: order++,
        apply: (target) => target.replies.push(reply),
      });
    for (const revision of thread.revisions)
      events.push({
        threadIndex,
        at: revision.createdAt,
        order: order++,
        apply: (target) => target.revisions.push(revision),
      });
    const latest = latestStatusId(thread);
    for (const event of thread.statusLog)
      if (event.id !== latest)
        events.push({
          threadIndex,
          at: event.at,
          order: order++,
          apply: (target) => target.statusLog.push(event),
        });
  });
  return events;
}

function assemble(
  threads: ReviewThread[],
  kept: OptionalEvent[],
  droppedThreads: Set<number>,
): PacketThread[] {
  const byThread = new Map<number, OptionalEvent[]>();
  for (const event of kept) {
    const list = byThread.get(event.threadIndex);
    if (list) list.push(event);
    else byThread.set(event.threadIndex, [event]);
  }
  const result: PacketThread[] = [];
  threads.forEach((thread, index) => {
    if (droppedThreads.has(index)) return;
    const packetThread = baseThread(thread);
    for (const event of byThread.get(index) ?? []) event.apply(packetThread);
    packetThread.replies.sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    packetThread.revisions.sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    packetThread.statusLog.sort(
      (a, b) => a.at - b.at || a.id.localeCompare(b.id),
    );
    const omittedReplies = thread.replies.length - packetThread.replies.length,
      omittedRevisions =
        thread.revisions.length - packetThread.revisions.length,
      omittedStatusEvents =
        thread.statusLog.length - packetThread.statusLog.length;
    if (omittedReplies || omittedRevisions || omittedStatusEvents) {
      const keptReplies = new Set(packetThread.replies.map((r) => r.id)),
        keptRevisions = new Set(packetThread.revisions.map((r) => r.id)),
        keptStatus = new Set(packetThread.statusLog.map((e) => e.id));
      const omittedTimes = [
        ...thread.replies
          .filter((r) => !keptReplies.has(r.id))
          .map((r) => r.createdAt),
        ...thread.revisions
          .filter((r) => !keptRevisions.has(r.id))
          .map((r) => r.createdAt),
        ...thread.statusLog
          .filter((e) => !keptStatus.has(e.id))
          .map((e) => e.at),
      ]
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      packetThread.omitted = {
        replies: omittedReplies,
        revisions: omittedRevisions,
        statusEvents: omittedStatusEvents,
        firstOmittedAt: omittedTimes[0],
        lastOmittedAt: omittedTimes[omittedTimes.length - 1],
      };
    }
    result.push(packetThread);
  });
  return result;
}

function buildReport(
  threads: ReviewThread[],
  packetThreads: PacketThread[],
  limit: number,
  droppedThreads: Set<number>,
): PacketReport {
  let omittedReplies = 0,
    omittedRevisions = 0,
    omittedStatusEvents = 0;
  const times: number[] = [];
  threads.forEach((thread, index) => {
    if (droppedThreads.has(index)) {
      omittedReplies += thread.replies.length;
      omittedRevisions += thread.revisions.length;
      omittedStatusEvents += thread.statusLog.length;
      for (const reply of thread.replies) times.push(reply.createdAt);
      for (const revision of thread.revisions) times.push(revision.createdAt);
      for (const event of thread.statusLog) times.push(event.at);
      return;
    }
    const packetThread = packetThreads.find((t) => t.id === thread.id);
    if (!packetThread?.omitted) return;
    omittedReplies += packetThread.omitted.replies;
    omittedRevisions += packetThread.omitted.revisions;
    omittedStatusEvents += packetThread.omitted.statusEvents;
    if (packetThread.omitted.firstOmittedAt !== undefined)
      times.push(packetThread.omitted.firstOmittedAt);
    if (packetThread.omitted.lastOmittedAt !== undefined)
      times.push(packetThread.omitted.lastOmittedAt);
  });
  times.sort((a, b) => a - b);
  const omittedThreadIds = threads
    .filter((_, index) => droppedThreads.has(index))
    .map((thread) => thread.id);
  const limited =
    omittedThreadIds.length > 0 ||
    omittedReplies > 0 ||
    omittedRevisions > 0 ||
    omittedStatusEvents > 0;
  const notes: string[] = [];
  if (limited) {
    notes.push(
      `为控制在 ${formatBytes(limit)} 内，已按时间从旧到新省略部分事件；每条讨论的正文、原始圈选与最新状态均保留。`,
    );
    if (omittedThreadIds.length)
      notes.push(
        `省略整条讨论 ${omittedThreadIds.length} 条（优先省略较早解决的讨论）。`,
      );
    if (omittedReplies) notes.push(`省略回复 ${omittedReplies} 条。`);
    if (omittedRevisions) notes.push(`省略定位修订 ${omittedRevisions} 条。`);
    if (omittedStatusEvents)
      notes.push(`省略历史状态 ${omittedStatusEvents} 条。`);
    if (times.length)
      notes.push(
        `省略事件的时间范围：${formatTime(times[0]!)} — ${formatTime(times[times.length - 1]!)}。`,
      );
    notes.push("原始圈选仍保留在每条讨论中，可据此重新定位。");
  }
  return {
    limited,
    limitBytes: limit,
    bytes: 0,
    totalThreads: threads.length,
    includedThreads: packetThreads.length,
    omittedThreads: omittedThreadIds.length,
    omittedReplies,
    omittedRevisions,
    omittedStatusEvents,
    omittedThreadIds,
    omittedFrom: times[0] ?? null,
    omittedTo: times[times.length - 1] ?? null,
    notes,
  };
}

function serialize(
  threads: ReviewThread[],
  kept: OptionalEvent[],
  droppedThreads: Set<number>,
  meta: PacketMeta,
  limit: number,
  withNotes: boolean,
) {
  const packetThreads = assemble(threads, kept, droppedThreads),
    report = buildReport(threads, packetThreads, limit, droppedThreads);
  if (!withNotes) report.notes = [];
  const packet: ReviewPacket = {
    kind: "panel-review-packet",
    version: 1,
    documentId: meta.documentId,
    documentTitle: meta.documentTitle,
    exportedAt: meta.exportedAt ?? Date.now(),
    exporter: meta.exporter,
    threads: packetThreads,
    report,
  };
  const json = JSON.stringify(packet),
    bytes = bytesOf(json);
  // 把真实字节数写回报告；长度变化极小，超出时由调用方继续收紧。
  report.bytes = bytes;
  const finalJson = JSON.stringify(packet);
  return { packet, json: finalJson, bytes: bytesOf(finalJson) };
}

/** 较早解决、较早创建的讨论先被整体省略。 */
function dropOrder(threads: ReviewThread[]) {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => {
      const aResolved = a.thread.status === "resolved" ? 0 : 1,
        bResolved = b.thread.status === "resolved" ? 0 : 1;
      if (aResolved !== bResolved) return aResolved - bResolved;
      return a.thread.statusAt - b.thread.statusAt;
    })
    .map((entry) => entry.index);
}

/**
 * 生成交换包。超出目标大小时按“新事件优先”保留：
 * 每条讨论的正文、原始圈选、当前定位与最新状态必留；
 * 其余回复/修订/历史状态按时间从旧到新截断，并在 report 中说明截断范围。
 */
export function buildPacket(
  threads: ReviewThread[],
  meta: PacketMeta,
  limitBytes: number,
): { packet: ReviewPacket; json: string; bytes: number } {
  const limit = clampLimit(limitBytes),
    events = optionalEvents(threads),
    // 新事件优先：时间倒序，同一时刻按生成顺序倒序。
    newestFirst = [...events].sort(
      (a, b) => b.at - a.at || b.order - a.order,
    ),
    droppedThreads = new Set<number>();

  const attempt = (keepCount: number, withNotes: boolean) =>
    serialize(
      threads,
      newestFirst.slice(0, keepCount),
      droppedThreads,
      meta,
      limit,
      withNotes,
    );

  const bestKeep = (withNotes: boolean) => {
    let low = 0,
      high = newestFirst.length,
      best = 0,
      output = attempt(0, withNotes);
    if (output.bytes > limit) return { keep: 0, output };
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = attempt(mid, withNotes);
      if (candidate.bytes <= limit) {
        best = mid;
        output = candidate;
        low = mid + 1;
      } else high = mid - 1;
    }
    return { keep: best, output };
  };

  let fitted = bestKeep(true);
  let output = fitted.output;
  const order = dropOrder(threads);
  let droppedCount = 0;
  // 连必留内容都放不下时，按顺序整条省略讨论后重新装入事件。
  while (output.bytes > limit && droppedCount < order.length) {
    droppedThreads.add(order[droppedCount]!);
    droppedCount++;
    fitted = bestKeep(true);
    output = fitted.output;
  }

  // 报告里的 bytes 字段写回后长度会微调，bestKeep 每次都重新序列化，
  // 因此这里得到的 output.bytes 已是对应真实文件的字节数。
  if (output.bytes <= limit) return output;

  // 极端情况：元数据本身超限。保留结构但去掉说明文字。
  const fallbackReport = buildReport(
      threads,
      output.packet.threads,
      limit,
      droppedThreads,
    ),
    fallback: ReviewPacket = {
      ...output.packet,
      report: { ...fallbackReport, notes: [] },
    },
    json = JSON.stringify(fallback);
  return { packet: fallback, json, bytes: bytesOf(json) };
}

export function clampLimit(value: number) {
  if (!Number.isFinite(value)) return MIN_PACKET_BYTES;
  return Math.max(
    MIN_PACKET_BYTES,
    Math.min(MAX_PACKET_BYTES, Math.round(value)),
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export { MAX_PACKET_BYTES, MIN_PACKET_BYTES };
