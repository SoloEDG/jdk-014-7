import { computed, ref, watch, type Ref } from "vue";
import type { ComicDocument } from "../../../shared/document";
import { makeId } from "../../../shared/commands";
import type {
  AnchorContext,
  AnchorRevision,
  AnchorSnapshot,
  NormalizedRect,
  RegionSelection,
  ReviewStatus,
  ReviewThread,
  StatusEvent,
} from "../model/review";
import {
  DEFAULT_PACKET_BYTES,
  MAX_PACKET_BYTES,
  MAX_REPLY_BODY,
  MAX_THREAD_BODY,
} from "../model/review";
import {
  anchorIsStale,
  buildAnchor,
  findPage,
  panelAtRect,
  panelLabel,
} from "../lib/anchor";
import { mergeThreads, type MergeSummary } from "../lib/merge";
import {
  buildPacket,
  formatBytes,
  type PacketMeta,
  type PacketReport,
} from "../lib/packet";
import {
  readReviewSession,
  writeReviewSession,
  normalizeThread,
} from "../lib/storage";
import { packetFileName, readPacketFile } from "../lib/packetFile";
import { demoThreads } from "../lib/demo";

export interface ReviewNotice {
  text: string;
  tone: "success" | "error" | "info";
}

export type ReviewFilter = "all" | "open" | "resolved" | "stale";

export function useReview(
  doc: Ref<ComicDocument>,
  reveal: (target: {
    chapterId: string;
    pageId: string;
    panelId: string;
  }) => void,
  onRestoreResume: () => void,
) {
  const saved = readReviewSession();
  const viewer = ref(saved.viewer),
    threads = ref<ReviewThread[]>(seed(saved.threads, doc.value)),
    activeId = ref(""),
    notice = ref<ReviewNotice | null>(null),
    open = ref(true),
    filter = ref<ReviewFilter>("all"),
    packetLimit = ref(DEFAULT_PACKET_BYTES),
    packetBusy = ref(false),
    exportReport = ref<PacketReport | null>(null);

  /** 画布交互状态：圈选 / 重新定位 / 待填写的圈选。 */
  const selecting = ref(false),
    relocating = ref(""),
    pending = ref<RegionSelection | null>(null);

  const active = computed(
    () => threads.value.find((t) => t.id === activeId.value) ?? null,
  );
  const counts = computed(() => {
    let openCount = 0,
      resolved = 0,
      stale = 0;
    for (const thread of threads.value) {
      if (thread.status === "resolved") resolved++;
      else openCount++;
      if (isStale(thread)) stale++;
    }
    return { total: threads.value.length, open: openCount, resolved, stale };
  });
  const staleIds = computed(() =>
    threads.value.filter(isStale).map((thread) => thread.id),
  );
  const visible = computed(() =>
    threads.value
      .filter((thread) => {
        if (filter.value === "open") return thread.status === "open";
        if (filter.value === "resolved") return thread.status === "resolved";
        if (filter.value === "stale") return isStale(thread);
        return true;
      })
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt),
  );

  function isStale(thread: ReviewThread) {
    const located = findPage(doc.value, thread.anchor.pageId);
    // 页面被删除，或作者重裁了分镜，都视为需要重新定位。
    return !located || anchorIsStale(thread.anchor, located.page);
  }

  function say(text: string, tone: ReviewNotice["tone"] = "success") {
    notice.value = { text, tone };
  }

  function persist() {
    const message = writeReviewSession({
      viewer: viewer.value,
      threads: threads.value,
    });
    if (message.includes("不足")) say(message, "error");
    else if (message.includes("未写入")) say(message, "info");
  }

  watch([threads, viewer], persist, { deep: true, immediate: true });

  /** 开始圈选：关闭重新定位，进入画布取点。 */
  function beginSelection() {
    relocating.value = "";
    pending.value = null;
    selecting.value = true;
    open.value = true;
    say("在画面上拖出要讨论的区域", "info");
  }

  function cancelSelection() {
    selecting.value = false;
    relocating.value = "";
    pending.value = null;
  }

  /** 画布上松开指针：先暂存圈选，等待填写批注。 */
  function takeSelection(rect: NormalizedRect, panelId: string) {
    const pageId = currentPageId.value;
    if (!pageId) return;
    if (relocating.value) {
      const id = relocating.value;
      selecting.value = false;
      relocating.value = "";
      relocate(id, rect);
      return;
    }
    pending.value = {
      chapterId: chapterIdForPage(pageId),
      pageId,
      panelId,
      rect,
    };
    selecting.value = false;
  }

  const currentPageId = ref("");

  function setCurrentPage(pageId: string) {
    currentPageId.value = pageId;
  }

  function chapterIdForPage(pageId: string) {
    return findPage(doc.value, pageId)?.chapter.id ?? "";
  }

  /** 圈选完成时的语境预览，供批注输入框展示。 */
  const pendingContext = computed<AnchorContext | null>(() => {
    const target = pending.value;
    if (!target) return null;
    const located = findPage(doc.value, target.pageId);
    if (!located) return null;
    const panel =
      located.page.panels.find((p) => p.id === target.panelId) ??
      panelAtRect(located.page, target.rect);
    return {
      chapterTitle: located.chapter.title,
      pageTitle: located.page.title,
      panelLabel: panel ? panelLabel(located.page, panel) : "整页",
      speaker: panel?.speaker ?? "旁白",
      dialogue: panel?.dialogue ?? "",
    };
  });

  /** 新建讨论：画面圈选 + 分镜语境一起入档。 */
  function create(body: string) {
    const target = pending.value;
    const text = body.trim();
    if (!target) return null;
    if (!text) {
      say("请先写下批注内容", "error");
      return null;
    }
    if (text.length > MAX_THREAD_BODY) {
      say(`批注不能超过 ${MAX_THREAD_BODY} 个字`, "error");
      return null;
    }
    const anchor = buildAnchor(
      doc.value,
      target,
      target.panelId,
      Date.now(),
    );
    if (!anchor) {
      say("无法定位这处圈选，请重新选择", "error");
      return null;
    }
    const now = Date.now();
    const thread: ReviewThread = {
      id: makeId("thread"),
      documentId: doc.value.id,
      createdAt: now,
      author: viewer.value,
      body: text,
      originalAnchor: anchor,
      anchor,
      revisions: [],
      replies: [],
      status: "open",
      statusAt: now,
      statusLog: [
        {
          id: makeId("status"),
          status: "open",
          author: viewer.value,
          at: now,
        },
      ],
    };
    threads.value = [thread, ...threads.value];
    activeId.value = thread.id;
    pending.value = null;
    open.value = true;
    say("批注已留在画面上，并记录了当前分镜与对白");
    // 圈选发生在当前视野内，不需要跳转，也不应进入“批注预览”而影响续读点。
    return thread;
  }

  function reply(threadId: string, body: string) {
    const text = body.trim();
    if (!text) return;
    if (text.length > MAX_REPLY_BODY) {
      say(`回复不能超过 ${MAX_REPLY_BODY} 个字`, "error");
      return;
    }
    const thread = threads.value.find((t) => t.id === threadId);
    if (!thread) return;
    const entry = {
      id: makeId("reply"),
      author: viewer.value,
      body: text,
      createdAt: Date.now(),
    };
    thread.replies = [...thread.replies, entry];
    threads.value = [...threads.value];
    say("回复已加入讨论");
  }

  function setStatus(threadId: string, status: ReviewStatus) {
    const thread = threads.value.find((t) => t.id === threadId);
    if (!thread || thread.status === status) return;
    const at = Date.now();
    const event: StatusEvent = {
      id: makeId("status"),
      status,
      author: viewer.value,
      at,
    };
    thread.status = status;
    thread.statusAt = at;
    thread.statusLog = [...thread.statusLog, event];
    threads.value = [...threads.value];
    say(status === "resolved" ? "讨论已标记为解决" : "讨论已重新打开");
  }

  /** 进入重新定位模式，等待画布上的新圈选。 */
  function beginRelocate(threadId: string) {
    const thread = threads.value.find((t) => t.id === threadId);
    if (!thread) return;
    selecting.value = false;
    pending.value = null;
    relocating.value = threadId;
    activeId.value = threadId;
    reveal({
      chapterId: thread.anchor.chapterId,
      pageId: thread.anchor.pageId,
      panelId: thread.anchor.panelId,
    });
    say("在画面上拖出新的圈选范围", "info");
  }

  /** 作者重裁分镜后，把圈选重新定位；原始圈选保留在 originalAnchor。 */
  function relocate(threadId: string, rect: NormalizedRect) {
    selecting.value = false;
    relocating.value = "";
    pending.value = null;
    const thread = threads.value.find((t) => t.id === threadId);
    if (!thread) return;
    const located = findPage(doc.value, thread.anchor.pageId);
    if (!located) {
      say("这一页已不在作品中，无法重新定位", "error");
      return;
    }
    const panel = panelAtRect(located.page, rect);
    const now = Date.now();
    const base = thread.anchor;
    const snapshot: AnchorSnapshot = {
      ...base,
      pageWidth: located.page.width,
      pageHeight: located.page.height,
      panelId: panel?.id ?? base.panelId,
      panelRect: panel ? { ...panel.rect } : base.panelRect,
      rect,
      context: {
        chapterTitle: located.chapter.title,
        pageTitle: located.page.title,
        panelLabel: panel
          ? panelLabel(located.page, panel)
          : base.context.panelLabel,
        speaker: panel?.speaker ?? base.context.speaker,
        dialogue: panel?.dialogue ?? base.context.dialogue,
      },
      createdAt: now,
    };
    const revision: AnchorRevision = {
      id: makeId("rev"),
      reason: "recrop",
      author: viewer.value,
      createdAt: now,
      anchor: snapshot,
    };
    thread.anchor = snapshot;
    thread.revisions = [...thread.revisions, revision];
    threads.value = [...threads.value];
    say("已重新定位，原始圈选仍保留在修订记录中");
  }

  async function importPacket(file: File) {
    packetBusy.value = true;
    try {
      const parsed = await readPacketFile(file);
      if (parsed.packet.documentId !== doc.value.id) {
        say(
          `这份审阅包属于另一部作品（${parsed.packet.documentTitle || parsed.packet.documentId}），未合并`,
          "error",
        );
        return null;
      }
      const { threads: merged, summary } = mergeThreads(
        threads.value,
        parsed.threads,
      );
      threads.value = merged;
      summarizeImport(parsed.packet.report, summary);
      return summary;
    } catch (error) {
      say(error instanceof Error ? error.message : "审阅包读取失败", "error");
      return null;
    } finally {
      packetBusy.value = false;
    }
  }

  function summarizeImport(report: PacketReport, summary: MergeSummary) {
    const parts: string[] = [];
    if (summary.addedThreads) parts.push(`新增讨论 ${summary.addedThreads} 条`);
    if (summary.addedReplies) parts.push(`合并回复 ${summary.addedReplies} 条`);
    if (summary.addedRevisions)
      parts.push(`定位修订 ${summary.addedRevisions} 条`);
    if (summary.duplicatesIgnored)
      parts.push(`忽略重复 ${summary.duplicatesIgnored} 条`);
    if (summary.resolvedKeptOverStaleOpen)
      parts.push(`保留已解决状态 ${summary.resolvedKeptOverStaleOpen} 条`);
    let text = parts.length ? parts.join("，") : "没有新的批注需要合并";
    if (report?.limited) {
      text += `。对方文件受 ${formatBytes(report.limitBytes)} 限制而有截断`;
      if (report.omittedReplies) text += `，缺少回复 ${report.omittedReplies} 条`;
      if (report.omittedThreads)
        text += `，缺少讨论 ${report.omittedThreads} 条`;
      text += "；本地已有内容不会被删除。";
    }
    say(
      text,
      summary.addedThreads || summary.addedReplies ? "success" : "info",
    );
  }

  /** 仅生成交换包（下载由调用方处理），便于测试与预览。 */
  function composePacket(meta: Omit<PacketMeta, "documentId">) {
    const output = buildPacket(
      threads.value,
      {
        ...meta,
        documentId: doc.value.id,
        exporter: meta.exporter || viewer.value,
      },
      packetLimit.value,
    );
    exportReport.value = output.packet.report;
    return output;
  }

  /** 生成并下载交换包；返回截断报告，便于界面解释。 */
  function exportPacket(meta: Omit<PacketMeta, "documentId">) {
    const output = composePacket(meta);
    const blob = new Blob([output.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = packetFileName(
      doc.value.title,
      meta.exporter || viewer.value,
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const report = output.packet.report;
    if (report.limited) {
      say(
        `已导出 ${formatBytes(output.bytes)}，为符合上限截断了一部分事件；详情见导出报告`,
        "info",
      );
    } else {
      say(`已导出 ${formatBytes(output.bytes)} 的审阅包`);
    }
    return output;
  }

  function focusThread(threadId: string) {
    const thread = threads.value.find((t) => t.id === threadId);
    if (!thread) return;
    activeId.value = thread.id;
    open.value = true;
    reveal({
      chapterId: thread.anchor.chapterId,
      pageId: thread.anchor.pageId,
      panelId: thread.anchor.panelId,
    });
  }

  function setViewer(name: string) {
    viewer.value = name.trim().slice(0, 40) || "匿名";
  }

  function setPacketLimit(value: number) {
    packetLimit.value = Math.max(
      32 * 1024,
      Math.min(MAX_PACKET_BYTES, Math.round(value)),
    );
  }

  function threadsOnPage(pageId: string) {
    return threads.value.filter((thread) => thread.anchor.pageId === pageId);
  }

  function replaceThreads(next: ReviewThread[]) {
    threads.value = next
      .map((t) => normalizeThread(t))
      .filter((t): t is ReviewThread => Boolean(t));
  }

  /** 重裁分镜：模拟作者修改作品；相关批注随即进入待重定位。 */
  function recropPanel(
    pageId: string,
    panelId: string,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    const located = findPage(doc.value, pageId);
    const panel = located?.page.panels.find((p) => p.id === panelId);
    if (!panel) return;
    panel.rect = rect;
    const affected = threads.value.filter(
      (thread) => thread.anchor.pageId === pageId && thread.anchor.panelId === panelId,
    ).length;
    say(
      affected
        ? `分镜已重裁，${affected} 条批注可在讨论中重新定位`
        : "分镜已重裁",
      "info",
    );
  }

  /** 回到正式续读点（阅读器联动）。 */
  function resumeReading() {
    onRestoreResume();
  }

  return {
    viewer,
    threads,
    visible,
    active,
    activeId,
    counts,
    notice,
    open,
    filter,
    packetLimit,
    packetBusy,
    exportReport,
    selecting,
    relocating,
    pending,
    pendingContext,
    staleIds,
    isStale,
    beginSelection,
    cancelSelection,
    takeSelection,
    setCurrentPage,
    create,
    reply,
    setStatus,
    beginRelocate,
    relocate,
    importPacket,
    exportPacket,
    composePacket,
    focusThread,
    setViewer,
    setPacketLimit,
    threadsOnPage,
    replaceThreads,
    recropPanel,
    resumeReading,
    say,
  };
}

function seed(stored: ReviewThread[], doc: ComicDocument) {
  if (stored.length) return stored.filter((t) => t.documentId === doc.id);
  return demoThreads(doc);
}

export type ReviewStore = ReturnType<typeof useReview>;
export type { PacketReport };
