import type { Rect } from "../../../shared/document";

/** 0–1 之间的页面归一化坐标，与缩放、整页/逐格视图无关。 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ReviewStatus = "open" | "resolved";
export type AnchorReason = "recrop" | "manual";

/** 圈选当时的语境快照。作者之后重裁分镜，也不会改写这里。 */
export interface AnchorContext {
  chapterTitle: string;
  pageTitle: string;
  panelLabel: string;
  speaker: string;
  dialogue: string;
}

export interface AnchorSnapshot {
  pageId: string;
  chapterId: string;
  panelId: string;
  pageWidth: number;
  pageHeight: number;
  /** 圈选时的分镜矩形（页面像素），用于发现作者重裁。 */
  panelRect: Rect;
  /** 圈选区域（页面归一化坐标）。 */
  rect: NormalizedRect;
  context: AnchorContext;
  createdAt: number;
}

/** 重新定位留下的一次修订；原始圈选永远单独保存在 originalAnchor。 */
export interface AnchorRevision {
  id: string;
  reason: AnchorReason;
  author: string;
  createdAt: number;
  anchor: AnchorSnapshot;
}

export interface ReviewReply {
  id: string;
  author: string;
  body: string;
  createdAt: number;
}

export interface StatusEvent {
  id: string;
  status: ReviewStatus;
  author: string;
  at: number;
}

export interface ReviewThread {
  id: string;
  documentId: string;
  createdAt: number;
  author: string;
  /** 首次批注正文。不参与截断，始终随讨论一起交换。 */
  body: string;
  originalAnchor: AnchorSnapshot;
  anchor: AnchorSnapshot;
  revisions: AnchorRevision[];
  replies: ReviewReply[];
  status: ReviewStatus;
  statusAt: number;
  statusLog: StatusEvent[];
}

/** 画布上完成一次圈选后交给父层的结果。 */
export interface RegionSelection {
  chapterId: string;
  pageId: string;
  panelId: string;
  rect: NormalizedRect;
}

export interface ReviewMergeReport {
  incomingThreads: number;
  addedThreads: number;
  addedReplies: number;
  addedRevisions: number;
  duplicatesIgnored: number;
  /** 旧文件里的“未解决”没有覆盖本地更新的“已解决”。 */
  resolvedKeptOverStaleOpen: number;
}

export const DEFAULT_PACKET_BYTES = 256 * 1024;
export const MIN_PACKET_BYTES = 32 * 1024;
export const MAX_PACKET_BYTES = 8 * 1024 * 1024;
export const MAX_THREAD_BODY = 2000;
export const MAX_REPLY_BODY = 2000;
