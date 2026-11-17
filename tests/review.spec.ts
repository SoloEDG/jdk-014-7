import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { demoDocument } from "../src/features/library/lib/demo";
import { useReader } from "../src/features/reader/model/reader";
import { useReview } from "../src/features/review/model/reviewStore";
import ReaderStage from "../src/features/reader/ui/ReaderStage.vue";
import ReviewPanel from "../src/features/review/ui/ReviewPanel.vue";
import type { ComicDocument } from "../src/shared/document";
import { mergeThread } from "../src/features/review/lib/merge";
import { parsePacket } from "../src/features/review/lib/packetFile";

beforeEach(() => localStorage.clear());

function workspace() {
  const doc = ref<ComicDocument>(demoDocument());
  const reader = useReader(doc);
  const review = useReview(
    doc,
    (t) => reader.reveal(t),
    () => reader.restoreResume(),
  );
  const page = reader.current.value.page!;
  review.setCurrentPage(page.id);
  return { doc, reader, review, page };
}

describe("圈选与讨论", () => {
  it("在画布上拖拽后创建带语境与区域的批注", async () => {
    const { review, page } = workspace();
    review.beginSelection();
    const rect = { x: 0.1, y: 0.12, width: 0.2, height: 0.15 };
    review.takeSelection(rect, page.panels[1]!.id);
    expect(review.pending.value).not.toBeNull();
    expect(review.pendingContext.value?.dialogue).toBeTruthy();
    const thread = review.create("这里的光线太亮");
    expect(thread).not.toBeNull();
    expect(thread!.anchor.rect).toEqual(rect);
    expect(thread!.originalAnchor.context.panelLabel).toContain(
      page.panels[1]!.speaker,
    );
    expect(review.counts.value.open).toBeGreaterThan(0);
  });

  it("圈选以页面坐标保存，切换视图不改变它归属的分镜", () => {
    const { review, reader, page } = workspace();
    const target = page.panels[2]!;
    const before = { ...reader.resume.value };
    review.takeSelection(
      {
        x: target.rect.x / page.width,
        y: target.rect.y / page.height,
        width: target.rect.width / page.width,
        height: target.rect.height / page.height,
      },
      target.id,
    );
    const thread = review.create("定位检查")!;
    // 新建批注不应把读者带离当前阅读位置。
    expect(reader.resume.value).toEqual(before);
    expect(reader.reviewing.value).toBe(false);
    reader.setMode("panel");
    expect(thread.anchor.pageId).toBe(page.id);
    expect(thread.anchor.panelId).toBe(target.id);
    expect(thread.anchor.rect.x).toBeCloseTo(target.rect.x / page.width, 6);
    expect(thread.anchor.rect.width).toBeCloseTo(
      target.rect.width / page.width,
      6,
    );
  });

  it("作者重裁后标记待重定位，重定位保留原始圈选", () => {
    const { review, page } = workspace();
    review.beginSelection();
    review.takeSelection(
      { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
      page.panels[0]!.id,
    );
    const thread = review.create("原圈选")!;
    expect(review.staleIds.value).not.toContain(thread.id);
    review.recropPanel(page.id, page.panels[0]!.id, {
      x: 30,
      y: 30,
      width: 500,
      height: 400,
    });
    expect(review.staleIds.value).toContain(thread.id);
    review.relocate(thread.id, {
      x: 0.22,
      y: 0.22,
      width: 0.12,
      height: 0.12,
    });
    const updated = review.threads.value.find((t) => t.id === thread.id)!;
    expect(updated.originalAnchor.rect).toEqual({
      x: 0.2,
      y: 0.2,
      width: 0.1,
      height: 0.1,
    });
    expect(updated.anchor.rect).toEqual({
      x: 0.22,
      y: 0.22,
      width: 0.12,
      height: 0.12,
    });
    expect(updated.revisions).toHaveLength(1);
    expect(review.staleIds.value).not.toContain(thread.id);
  });
});

describe("离线交换", () => {
  it("两个副本合并后回复齐全且不重复", async () => {
    const a = workspace();
    const b = workspace();
    const threadA = a.review.threads.value[0]!;
    const threadB = b.review.threads.value[0]!;
    a.review.reply(threadA.id, "A 离线回复");
    b.review.reply(threadB.id, "B 离线回复");
    const packet = b.review.composePacket({
      documentTitle: b.doc.value.title,
      exporter: "B",
    });
    const parsed = parsePacket(packet.json, "b.panel-review.json");
    const { mergeThreads } = await import("../src/features/review/lib/merge");
    const merged = mergeThreads(a.review.threads.value, parsed.threads);
    const target = merged.threads.find((t) => t.id === threadA.id)!;
    const bodies = target.replies.map((r) => r.body);
    expect(bodies).toContain("A 离线回复");
    expect(bodies).toContain("B 离线回复");
    expect(new Set(target.replies.map((r) => r.id)).size).toBe(
      target.replies.length,
    );
  });

  it("旧文件里的未解决不会让已解决讨论倒退", () => {
    const { review } = workspace();
    const thread = review.threads.value.find((t) => t.status === "open")!;
    review.setStatus(thread.id, "resolved");
    const stale = {
      ...review.threads.value.find((t) => t.id === thread.id)!,
      status: "open" as const,
      statusAt: 1,
      statusLog: [
        { id: `${thread.id}-old`, status: "open" as const, author: "旧", at: 1 },
      ],
    };
    const merged = mergeThread(
      review.threads.value.find((t) => t.id === thread.id)!,
      stale,
    );
    expect(merged.thread.status).toBe("resolved");
  });
});

describe("批注浏览不改续读点", () => {
  it("点击批注只预览位置，回到续读点恢复", async () => {
    const { review, reader, page } = workspace();
    reader.dispatch({ type: "panel", id: page.panels[0]!.id });
    reader.setMode("panel");
    await nextTick();
    const resume = { ...reader.resume.value };
    const other = review.threads.value.find(
      (t) => t.anchor.panelId !== resume.panelId,
    );
    if (other) {
      review.focusThread(other.id);
      expect(reader.reviewing.value).toBe(true);
      expect(reader.resume.value).toEqual(resume);
      review.resumeReading();
      expect(reader.current.value.panel?.id).toBe(resume.panelId);
    }
  });
});

describe("界面挂载", () => {
  it("阅读器与批注面板可以渲染", () => {
    const { review, reader, page } = workspace();
    const stage = mount(ReaderStage, {
      props: {
        page,
        panel: reader.current.value.panel!,
        location: reader.location.value,
        mode: "page",
        threads: review.threads.value,
        activeReviewId: "",
        selecting: false,
        relocating: "",
        staleIds: [],
      },
    });
    expect(stage.find(".review-layer").exists()).toBe(true);
    expect(stage.findAll(".review-marker").length).toBeGreaterThan(0);
    const panel = mount(ReviewPanel, {
      props: {
        threads: review.visible.value,
        counts: review.counts.value,
        filter: "all",
        activeId: "",
        viewer: "林",
        open: true,
        staleIds: [],
        notice: null,
        packetLimit: 262144,
        packetBusy: false,
        exportReport: null,
        relocating: "",
      },
    });
    expect(panel.text()).toContain("批注讨论");
    expect(panel.text()).toContain("离线交换");
  });
});

describe("交换包压力与界面整页挂载", () => {
  it("极小限额下也绝不超过上限，并解释截断", async () => {
    const { buildPacket } = await import("../src/features/review/lib/packet");
    const { demoDocument } = await import("../src/features/library/lib/demo");
    const localDoc = demoDocument();
    const { buildAnchor } = await import("../src/features/review/lib/anchor");
    const chapter = localDoc.chapters[0]!;
    const page = chapter.pages[0]!;
    const panel = page.panels[0]!;
    const anchor = buildAnchor(
      localDoc,
      {
        chapterId: chapter.id,
        pageId: page.id,
        panelId: panel.id,
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      },
      panel.id,
      1,
    )!;
    const heavy = Array.from({ length: 40 }, (_, i) => ({
      id: `heavy-${i}`,
      documentId: localDoc.id,
      createdAt: 1000 + i,
      author: "审阅者".repeat(3),
      body: "这是一条很长的批注正文，用来制造超限。".repeat(30).slice(0, 2000),
      originalAnchor: anchor,
      anchor,
      revisions: [],
      replies: Array.from({ length: 10 }, (_, n) => ({
        id: `heavy-${i}-r${n}`,
        author: "回复者",
        body: "同样很长的离线回复内容".repeat(20),
        createdAt: 2000 + i * 20 + n,
      })),
      status: "open" as const,
      statusAt: 1000 + i,
      statusLog: [
        {
          id: `heavy-${i}-s`,
          status: "open" as const,
          author: "审阅者",
          at: 1000 + i,
        },
      ],
    }));
    for (const limit of [32 * 1024, 64 * 1024, 128 * 1024]) {
      const output = buildPacket(
        heavy,
        { documentId: localDoc.id, documentTitle: localDoc.title, exporter: "甲" },
        limit,
      );
      expect(output.bytes).toBeLessThanOrEqual(limit);
      expect(output.packet.report.limited).toBe(true);
      expect(output.packet.report.omittedReplies).toBeGreaterThan(0);
      for (const thread of output.packet.threads) {
        expect(thread.body.length).toBeGreaterThan(0);
        expect(thread.originalAnchor.rect.width).toBeGreaterThan(0);
        expect(thread.statusLog.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("整个应用可以挂载并完成一次圈选流程", async () => {
    const { default: App } = await import("../src/app/App.vue");
    const { mount } = await import("@vue/test-utils");
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    expect(wrapper.find(".reader-stage").exists()).toBe(true);
    expect(wrapper.findAll(".review-marker").length).toBeGreaterThan(0);
    // 打开圈选
    await wrapper.find(".annotate-button").trigger("click");
    expect(wrapper.find(".review-layer").classes()).toContain("selecting");
    // 取消
    const cancel = wrapper
      .findAll(".review-mode-banner button")
      .find((b) => b.text().includes("取消圈选"));
    expect(cancel).toBeTruthy();
    await cancel!.trigger("click");
    expect(wrapper.find(".review-layer").classes()).not.toContain("selecting");
    wrapper.unmount();
  });
});

describe("导入健壮性", () => {
  it("同一份审阅包重复导入不会产生重复内容", async () => {
    const a = workspace();
    const b = workspace();
    b.review.reply(b.review.threads.value[0]!.id, "离线补充");
    const packet = b.review.composePacket({
      documentTitle: b.doc.value.title,
      exporter: "B",
    });
    const file = new File([packet.json], "b.panel-review.json", {
      type: "application/json",
    });
    await a.review.importPacket(file);
    const afterFirst = JSON.stringify(a.review.threads.value);
    await a.review.importPacket(file);
    expect(JSON.stringify(a.review.threads.value)).toBe(afterFirst);
  });

  it("拒绝其他作品的审阅包", async () => {
    const { review, doc } = workspace();
    const foreign = {
      kind: "panel-review-packet",
      version: 1,
      documentId: "another-comic",
      documentTitle: "另一部作品",
      exportedAt: 1,
      exporter: "外人",
      threads: [],
      report: { limited: false, limitBytes: 0, notes: [] },
    };
    const file = new File([JSON.stringify(foreign)], "x.json", {
      type: "application/json",
    });
    const result = await review.importPacket(file);
    expect(result).toBeNull();
    expect(review.notice.value?.tone).toBe("error");
    expect(review.notice.value?.text).toContain("另一部作品");
    expect(doc.value.id).not.toBe("another-comic");
  });

  it("拒绝非审阅包与损坏 JSON", async () => {
    const { review } = workspace();
    const junk = new File(["not json"], "a.json", { type: "application/json" });
    expect(await review.importPacket(junk)).toBeNull();
    expect(review.notice.value?.text).toContain("JSON");
    const unrelated = new File([JSON.stringify({ hello: 1 })], "b.json", {
      type: "application/json",
    });
    expect(await review.importPacket(unrelated)).toBeNull();
    expect(review.notice.value?.text).toContain("审阅包");
  });
});
