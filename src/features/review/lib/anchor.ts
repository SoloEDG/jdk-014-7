import type {
  ComicDocument,
  ComicPage,
  Panel,
  Rect,
  ReadingMode,
} from "../../../shared/document";
import type {
  AnchorSnapshot,
  NormalizedRect,
  RegionSelection,
} from "../model/review";

/** 当前视口在整页坐标系中展示的区域（页面像素）。 */
export function viewRegion(
  page: ComicPage,
  panel: Panel,
  mode: ReadingMode,
): Rect {
  return mode === "panel"
    ? panel.rect
    : { x: 0, y: 0, width: page.width, height: page.height };
}

export interface ElementBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 把指针在渲染元素内的位置换算成整页归一化坐标。
 * 元素外框已包含 zoom/pan 变换，因此这里只处理比例，
 * 整页与逐格两种裁切都使用同一套换算。
 */
export function pointerToPage(
  page: ComicPage,
  region: Rect,
  box: ElementBox,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const fx = box.width ? (clientX - box.left) / box.width : 0,
    fy = box.height ? (clientY - box.top) / box.height : 0;
  return {
    x: clamp01((region.x + fx * region.width) / page.width),
    y: clamp01((region.y + fy * region.height) / page.height),
  };
}

/** 两次页面归一化坐标 → 归一化矩形（最小 0.2% 防止零面积）。 */
export function normalizedSelection(
  page: ComicPage,
  from: { x: number; y: number },
  to: { x: number; y: number },
): NormalizedRect {
  const x = clamp01(Math.min(from.x, to.x)),
    y = clamp01(Math.min(from.y, to.y)),
    maxX = clamp01(Math.max(from.x, to.x)),
    maxY = clamp01(Math.max(from.y, to.y));
  return {
    x,
    y,
    width: Math.max(0.002, maxX - x),
    height: Math.max(0.002, maxY - y),
  };
}

/**
 * 归一化矩形 → 当前视口内的百分比定位。
 * 因为覆盖层与图片在同一个被缩放的元素里，圈选不会随缩放漂移。
 */
export function overlayStyle(
  page: ComicPage,
  region: Rect,
  rect: NormalizedRect,
): { left: string; top: string; width: string; height: string } {
  const pct = (v: number) => `${v * 100}%`;
  return {
    left: pct((rect.x * page.width - region.x) / region.width),
    top: pct((rect.y * page.height - region.y) / region.height),
    width: pct((rect.width * page.width) / region.width),
    height: pct((rect.height * page.height) / region.height),
  };
}

/** 两次页面坐标是否落在同一个分镜，返回重叠面积最大的分镜。 */
export function panelAtRect(
  page: ComicPage,
  rect: NormalizedRect,
): Panel | undefined {
  const box = {
    x: rect.x * page.width,
    y: rect.y * page.height,
    width: rect.width * page.width,
    height: rect.height * page.height,
  };
  let best: Panel | undefined,
    bestArea = 0;
  for (const panel of page.panels) {
    const area = overlapArea(box, panel.rect);
    if (area > bestArea) {
      bestArea = area;
      best = panel;
    }
  }
  return best ?? page.panels[0];
}

function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

export function panelLabel(page: ComicPage, panel: Panel) {
  const index = page.panels.findIndex((p) => p.id === panel.id);
  return `第 ${Math.max(0, index) + 1} 格 · ${panel.speaker}`;
}

/** 从一次圈选构建不可变的语境快照。 */
export function buildAnchor(
  doc: ComicDocument,
  selection: RegionSelection,
  panelId: string,
  createdAt: number,
): AnchorSnapshot | null {
  const located = findPage(doc, selection.pageId);
  if (!located) return null;
  const { chapter, page } = located;
  const panel =
    page.panels.find((p) => p.id === panelId) ??
    panelAtRect(page, selection.rect);
  if (!panel) return null;
  return {
    chapterId: chapter.id,
    pageId: page.id,
    panelId: panel.id,
    pageWidth: page.width,
    pageHeight: page.height,
    panelRect: { ...panel.rect },
    rect: selection.rect,
    context: {
      chapterTitle: chapter.title,
      pageTitle: page.title,
      panelLabel: panelLabel(page, panel),
      speaker: panel.speaker,
      dialogue: panel.dialogue,
    },
    createdAt,
  };
}

/** 作者重裁分镜后，圈选所依附的分镜几何发生变化。 */
export function anchorIsStale(
  anchor: AnchorSnapshot,
  page: ComicPage | undefined,
): boolean {
  if (!page) return false;
  const panel = page.panels.find((p) => p.id === anchor.panelId);
  if (!panel) return true;
  const a = anchor.panelRect,
    b = panel.rect;
  return (
    Math.abs(a.x - b.x) > 1 ||
    Math.abs(a.y - b.y) > 1 ||
    Math.abs(a.width - b.width) > 1 ||
    Math.abs(a.height - b.height) > 1
  );
}

export function findPage(
  doc: ComicDocument,
  pageId: string,
): { chapter: ComicDocument["chapters"][number]; page: ComicPage } | null {
  for (const chapter of doc.chapters) {
    const page = chapter.pages.find((p) => p.id === pageId);
    if (page) return { chapter, page };
  }
  return null;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** 供缩略图定位：整页背景中的圈选位置。 */
export function thumbMarker(page: ComicPage, rect: NormalizedRect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${Math.min(1, rect.width) * 100}%`,
    height: `${Math.min(1, rect.height) * 100}%`,
  };
}
