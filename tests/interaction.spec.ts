import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ReaderStage from "../src/features/reader/ui/ReaderStage.vue";
import ReviewComposer from "../src/features/review/ui/ReviewComposer.vue";
import { demoDocument } from "../src/features/library/lib/demo";
import type { ReviewThread } from "../src/features/review/model/review";

const doc = demoDocument();
const page = doc.chapters[0]!.pages[0]!;
const panel = page.panels[0]!;

function stageProps(over: Record<string, unknown> = {}) {
  return {
    doc,
    page,
    panel,
    location: {
      chapterId: doc.chapters[0]!.id,
      pageId: page.id,
      panelId: panel.id,
      zoom: 1,
      x: 0,
      y: 0,
    },
    mode: "page" as const,
    threads: [] as ReviewThread[],
    activeReviewId: "",
    selecting: false,
    relocating: "",
    staleIds: [] as string[],
    ...over,
  };
}

/** jsdom 不做布局，手动给圈选层一个 450×600 的矩形。 */
function stubLayout(el: Element, left = 100, top = 50, width = 450, height = 600) {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON() {},
    }) as DOMRect;
}

function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

describe("画布圈选交互", () => {
  it("整页拖拽产出页面归一化矩形与分镜", async () => {
    const wrapper = mount(ReaderStage, {
      props: stageProps({ selecting: true }),
    });
    await nextTick();
    const layer = wrapper.find(".review-layer").element;
    stubLayout(layer);
    pointer(layer, "pointerdown", 100 + 450 * 0.2, 50 + 600 * 0.25);
    pointer(layer, "pointermove", 100 + 450 * 0.5, 50 + 600 * 0.55);
    pointer(layer, "pointerup", 100 + 450 * 0.5, 50 + 600 * 0.55);
    await nextTick();
    const events = wrapper.emitted("createReview") as [unknown, string][];
    expect(events).toBeTruthy();
    const [rect, panelId] = events[0]!;
    expect(rect.x).toBeCloseTo(0.2, 6);
    expect(rect.y).toBeCloseTo(0.25, 6);
    expect(rect.width).toBeCloseTo(0.3, 6);
    expect(rect.height).toBeCloseTo(0.3, 6);
    expect(panelId).toBe(panel.id);
  });

  it("逐格模式把拖拽换算成同一页面的绝对坐标", async () => {
    const target = page.panels[1]!;
    const wrapper = mount(ReaderStage, {
      props: stageProps({ selecting: true, panel: target, mode: "panel" }),
    });
    await nextTick();
    const layer = wrapper.find(".review-layer").element;
    stubLayout(layer, 0, 0, 400, 400);
    // 拖满整个逐格视口 = 恰好是该分镜在整页中的区域
    pointer(layer, "pointerdown", 0, 0);
    pointer(layer, "pointermove", 400, 400);
    pointer(layer, "pointerup", 400, 400);
    await nextTick();
    const [rect] = (wrapper.emitted("relocateReview") ??
      wrapper.emitted("createReview") ??
      [])[0] as [{ x: number; y: number; width: number; height: number }, string];
    expect(rect.x).toBeCloseTo(target.rect.x / page.width, 5);
    expect(rect.y).toBeCloseTo(target.rect.y / page.height, 5);
    expect(rect.width).toBeCloseTo(target.rect.width / page.width, 5);
    expect(rect.height).toBeCloseTo(target.rect.height / page.height, 5);
  });

  it("重新定位模式发出 relocateReview 而不是新建", async () => {
    const wrapper = mount(ReaderStage, {
      props: stageProps({ relocating: "thread-9" }),
    });
    await nextTick();
    const layer = wrapper.find(".review-layer").element;
    stubLayout(layer);
    pointer(layer, "pointerdown", 120, 80);
    pointer(layer, "pointermove", 300, 260);
    pointer(layer, "pointerup", 300, 260);
    await nextTick();
    const events = wrapper.emitted("relocateReview") as [string, unknown][];
    expect(events?.[0]?.[0]).toBe("thread-9");
    expect(wrapper.emitted("createReview")).toBeFalsy();
  });

  it("过小圈选被忽略，不会创建空批注", async () => {
    const wrapper = mount(ReaderStage, {
      props: stageProps({ selecting: true }),
    });
    await nextTick();
    const layer = wrapper.find(".review-layer").element;
    stubLayout(layer);
    pointer(layer, "pointerdown", 200, 200);
    pointer(layer, "pointerup", 200, 200);
    await nextTick();
    expect(wrapper.emitted("createReview")).toBeFalsy();
  });

  it("非圈选状态不拦截画面，点击标记可选中讨论", async () => {
    const threads = [
      {
        id: "t1",
        anchor: { pageId: page.id, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
        originalAnchor: { rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
        revisions: [],
        replies: [],
        status: "open",
        body: "x",
        author: "a",
        createdAt: 1,
      },
    ] as unknown as ReviewThread[];
    const wrapper = mount(ReaderStage, { props: stageProps({ threads }) });
    await nextTick();
    expect(wrapper.find(".review-layer").classes()).not.toContain("selecting");
    await wrapper.find(".review-marker").trigger("click");
    expect(wrapper.emitted("selectReview")![0]).toEqual(["t1"]);
  });
});

describe("批注输入框", () => {
  it("展示语境，保存时回传正文", async () => {
    const wrapper = mount(ReviewComposer, {
      props: {
        open: true,
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        panelId: panel.id,
        context: {
          chapterTitle: "第一章",
          pageTitle: "第 1 页",
          panelLabel: "第 1 格 · 旁白",
          speaker: "旁白",
          dialogue: panel.dialogue,
        },
        modeLabel: "整页模式",
      },
    });
    expect(wrapper.text()).toContain(panel.dialogue);
    await wrapper.find("textarea").setValue("光线太亮");
    await wrapper.find(".review-primary").trigger("click");
    expect(wrapper.emitted("save")![0]).toEqual(["光线太亮"]);
  });
});
