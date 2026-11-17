import type { ReviewPacket } from "./packet";
import { normalizeThread } from "./storage";
import type { ReviewThread } from "../model/review";

export interface ParsedPacket {
  packet: ReviewPacket;
  threads: ReviewThread[];
  fileName: string;
}

export class PacketError extends Error {}

/** 解析并校验对方发回的交换文件。 */
export function parsePacket(text: string, fileName: string): ParsedPacket {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PacketError("文件不是有效的 JSON，无法读取审阅内容");
  }
  if (!value || typeof value !== "object")
    throw new PacketError("文件内容为空或格式不正确");
  const raw = value as Partial<ReviewPacket>;
  if (raw.kind !== "panel-review-packet")
    throw new PacketError("这不是 PANEL 审阅包，请选择导出的 .panel-review.json 文件");
  if (raw.version !== 1)
    throw new PacketError(`不支持的审阅包版本：${String(raw.version)}`);
  if (typeof raw.documentId !== "string" || !raw.documentId)
    throw new PacketError("审阅包缺少作品标识");
  if (!Array.isArray(raw.threads))
    throw new PacketError("审阅包缺少讨论数据");
  const threads: ReviewThread[] = [];
  for (const entry of raw.threads.slice(0, 5000)) {
    const thread = normalizeThread(entry);
    if (!thread) continue;
    if (thread.documentId !== raw.documentId) continue;
    threads.push(thread);
  }
  return {
    packet: {
      kind: "panel-review-packet",
      version: 1,
      documentId: raw.documentId,
      documentTitle:
        typeof raw.documentTitle === "string" ? raw.documentTitle : "",
      exportedAt:
        typeof raw.exportedAt === "number" ? raw.exportedAt : Date.now(),
      exporter: typeof raw.exporter === "string" ? raw.exporter : "未知",
      threads: [],
      report: normalizeReport(raw.report, threads.length),
    },
    threads,
    fileName,
  };
}

/** 交换文件来自外部，报告字段也要逐项校验后再展示。 */
function normalizeReport(value: unknown, threadCount: number) {
  const r =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const num = (key: string) =>
    typeof r[key] === "number" && Number.isFinite(r[key])
      ? Math.max(0, Math.round(r[key] as number))
      : 0;
  const maybeTime = (key: string) =>
    typeof r[key] === "number" && Number.isFinite(r[key])
      ? (r[key] as number)
      : null;
  const notes = Array.isArray(r.notes)
    ? r.notes
        .filter((n): n is string => typeof n === "string")
        .slice(0, 20)
        .map((n) => n.slice(0, 500))
    : [];
  const omittedThreadIds = Array.isArray(r.omittedThreadIds)
    ? r.omittedThreadIds
        .filter((id): id is string => typeof id === "string")
        .slice(0, 500)
    : [];
  return {
    limited: r.limited === true,
    limitBytes: num("limitBytes"),
    bytes: num("bytes"),
    totalThreads: num("totalThreads") || threadCount,
    includedThreads: num("includedThreads") || threadCount,
    omittedThreads: num("omittedThreads"),
    omittedReplies: num("omittedReplies"),
    omittedRevisions: num("omittedRevisions"),
    omittedStatusEvents: num("omittedStatusEvents"),
    omittedThreadIds,
    omittedFrom: maybeTime("omittedFrom"),
    omittedTo: maybeTime("omittedTo"),
    notes,
  };
}

export async function readPacketFile(file: File): Promise<ParsedPacket> {
  if (file.size > 12 * 1024 * 1024)
    throw new PacketError("审阅包不能超过 12 MB");
  return parsePacket(await file.text(), file.name);
}

export function packetFileName(documentTitle: string, exporter: string) {
  const safe = (value: string) =>
    value
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40) || "comic";
  const date = new Date().toISOString().slice(0, 10);
  return `${safe(documentTitle)}-${safe(exporter)}-${date}.panel-review.json`;
}
