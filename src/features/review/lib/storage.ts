import type { ReviewThread } from "../model/review";
import {
  MAX_REPLY_BODY,
  MAX_THREAD_BODY,
} from "../model/review";

const KEY = "panel-jdk014-review-v1";
const MAX_STORED_THREADS = 2000;
const MAX_STORED_REPLIES = 300;
const MAX_STORED_REVISIONS = 100;

export interface ReviewSession {
  viewer: string;
  threads: ReviewThread[];
}

export function readReviewSession(): ReviewSession {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { viewer: "林", threads: [] };
    const value = JSON.parse(raw) as Partial<ReviewSession>;
    return {
      viewer:
        typeof value.viewer === "string" && value.viewer.trim()
          ? value.viewer.trim().slice(0, 40)
          : "林",
      threads: Array.isArray(value.threads)
        ? value.threads
            .map(normalizeThread)
            .filter((t): t is ReviewThread => Boolean(t))
            .slice(0, MAX_STORED_THREADS)
        : [],
    };
  } catch {
    return { viewer: "林", threads: [] };
  }
}

export function writeReviewSession(session: ReviewSession): string {
  try {
    const overflowThreads = Math.max(
      0,
      session.threads.length - MAX_STORED_THREADS,
    );
    let overflowEvents = 0;
    const threads = session.threads.slice(0, MAX_STORED_THREADS).map((t) => {
      overflowEvents += Math.max(0, t.replies.length - MAX_STORED_REPLIES);
      overflowEvents += Math.max(0, t.revisions.length - MAX_STORED_REVISIONS);
      return {
        ...t,
        replies: t.replies.slice(-MAX_STORED_REPLIES),
        revisions: t.revisions.slice(-MAX_STORED_REVISIONS),
      };
    });
    // 只写回最近的部分，避免 localStorage 写满后全部保存失败。
    localStorage.setItem(
      KEY,
      JSON.stringify({ viewer: session.viewer, threads }),
    );
    if (overflowThreads || overflowEvents)
      return `批注已保存；受浏览器存储限制，较早的 ${overflowEvents} 条回复/修订与 ${overflowThreads} 条讨论未写入，请先导出审阅包`;
    return "批注已保存到此浏览器";
  } catch {
    return "批注存储空间不足；请导出审阅包后清理较早的讨论";
  }
}

/** 只接受结构完整、数值有限的讨论，避免坏文件破坏本地状态。 */
export function normalizeThread(value: unknown): ReviewThread | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Partial<ReviewThread>;
  if (typeof t.id !== "string" || !t.id) return null;
  if (typeof t.documentId !== "string" || !t.documentId) return null;
  const original = normalizeAnchor(t.originalAnchor);
  if (!original) return null;
  const anchor = normalizeAnchor(t.anchor) ?? original;
  const createdAt = finite(t.createdAt) ?? anchor.createdAt;
  const status = t.status === "resolved" ? "resolved" : "open";
  const replies = Array.isArray(t.replies)
    ? t.replies
        .map(normalizeReply)
        .filter((r): r is ReviewThread["replies"][number] => Boolean(r))
        .slice(0, 2000)
    : [];
  const revisions = Array.isArray(t.revisions)
    ? t.revisions
        .map(normalizeRevision)
        .filter((r): r is ReviewThread["revisions"][number] => Boolean(r))
        .slice(0, 500)
    : [];
  const statusLog = Array.isArray(t.statusLog)
    ? t.statusLog
        .map(normalizeStatus)
        .filter((e): e is ReviewThread["statusLog"][number] => Boolean(e))
        .slice(0, 500)
    : [];
  if (!statusLog.length)
    statusLog.push({
      id: `${t.id}-legacy-${finite(t.statusAt) ?? createdAt}`,
      status,
      author: text(t.author, 40) ?? "匿名",
      at: finite(t.statusAt) ?? createdAt,
    });
  // 以事件日志的最新一条为准，避免字段各自为政。
  const latest = statusLog.reduce((best, event) =>
    event.at > best.at || (event.at === best.at && event.id >= best.id)
      ? event
      : best,
  );
  return {
    id: t.id.slice(0, 80),
    documentId: t.documentId.slice(0, 80),
    createdAt,
    author: text(t.author, 40) ?? "匿名",
    body: text(t.body, MAX_THREAD_BODY) ?? "",
    originalAnchor: original,
    anchor,
    revisions,
    replies,
    status: latest.status,
    statusAt: latest.at,
    statusLog,
  };
}

export function normalizeAnchor(value: unknown): ReviewThread["anchor"] | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Partial<ReviewThread["anchor"]>;
  const rect = normalizeRect(a.rect),
    panelRect = normalizePanelRect(a.panelRect);
  if (!rect || !panelRect) return null;
  if (typeof a.pageId !== "string" || !a.pageId) return null;
  const context = a.context ?? ({} as ReviewThread["anchor"]["context"]);
  return {
    chapterId: typeof a.chapterId === "string" ? a.chapterId : "",
    pageId: a.pageId.slice(0, 80),
    panelId: typeof a.panelId === "string" ? a.panelId : "",
    pageWidth: positive(a.pageWidth) ?? 1000,
    pageHeight: positive(a.pageHeight) ?? 1000,
    panelRect,
    rect,
    context: {
      chapterTitle: text(context.chapterTitle, 120) ?? "",
      pageTitle: text(context.pageTitle, 120) ?? "",
      panelLabel: text(context.panelLabel, 120) ?? "",
      speaker: text(context.speaker, 40) ?? "",
      dialogue: text(context.dialogue, 2000) ?? "",
    },
    createdAt: finite(a.createdAt) ?? Date.now(),
  };
}

function normalizeReply(value: unknown): ReviewThread["replies"][number] | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const body = text(r.body, MAX_REPLY_BODY);
  if (!body) return null;
  return {
    id: r.id.slice(0, 80),
    author: text(r.author, 40) ?? "匿名",
    body,
    createdAt: finite(r.createdAt) ?? Date.now(),
  };
}

function normalizeRevision(
  value: unknown,
): ReviewThread["revisions"][number] | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const anchor = normalizeAnchor(r.anchor);
  if (!anchor) return null;
  return {
    id: r.id.slice(0, 80),
    reason: r.reason === "recrop" ? "recrop" : "manual",
    author: text(r.author, 40) ?? "匿名",
    createdAt: finite(r.createdAt) ?? Date.now(),
    anchor,
  };
}

function normalizeStatus(
  value: unknown,
): ReviewThread["statusLog"][number] | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) return null;
  if (e.status !== "open" && e.status !== "resolved") return null;
  return {
    id: e.id.slice(0, 100),
    status: e.status,
    author: text(e.author, 40) ?? "匿名",
    at: finite(e.at) ?? Date.now(),
  };
}

function normalizeRect(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const x = finite(r.x),
    y = finite(r.y),
    width = finite(r.width),
    height = finite(r.height);
  if (x === undefined || y === undefined) return null;
  if (width === undefined || height === undefined) return null;
  const cx = clamp01(x),
    cy = clamp01(y);
  return {
    x: cx,
    y: cy,
    width: Math.max(0.002, Math.min(1 - cx, Math.abs(width))),
    height: Math.max(0.002, Math.min(1 - cy, Math.abs(height))),
  };
}

function normalizePanelRect(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const x = finite(r.x),
    y = finite(r.y),
    width = finite(r.width),
    height = finite(r.height);
  if (x === undefined || y === undefined) return null;
  if (width === undefined || height === undefined) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function positive(value: unknown) {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}
