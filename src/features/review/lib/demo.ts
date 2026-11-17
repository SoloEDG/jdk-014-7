import type { ComicDocument } from "../../../shared/document";
import type { ReviewThread } from "../model/review";
import { buildAnchor } from "../lib/anchor";

/**
 * 首次打开时给演示作品放两条示例讨论，
 * 用来展示“分镜语境 + 画面区域 + 已解决状态”。
 */
export function demoThreads(doc: ComicDocument): ReviewThread[] {
  const chapter = doc.chapters[0],
    page = chapter?.pages[0];
  if (!chapter || !page) return [];
  const createdAt = Date.now() - 90 * 60 * 1000;
  const make = (
    id: string,
    panelIndex: number,
    rect: { x: number; y: number; width: number; height: number },
    body: string,
    author: string,
    replies: { author: string; body: string; offset: number }[],
    resolved: boolean,
  ): ReviewThread | null => {
    const panel = page.panels[panelIndex];
    if (!panel) return null;
    const anchor = buildAnchor(
      doc,
      {
        chapterId: chapter.id,
        pageId: page.id,
        panelId: panel.id,
        rect,
      },
      panel.id,
      createdAt,
    );
    if (!anchor) return null;
    const thread: ReviewThread = {
      id,
      documentId: doc.id,
      createdAt,
      author,
      body,
      originalAnchor: anchor,
      anchor: { ...anchor },
      revisions: [],
      replies: replies.map((reply, index) => ({
        id: `${id}-reply-${index}`,
        author: reply.author,
        body: reply.body,
        createdAt: createdAt + reply.offset,
      })),
      status: resolved ? "resolved" : "open",
      statusAt: createdAt + 30 * 60 * 1000,
      statusLog: [
        {
          id: `${id}-status-open`,
          status: "open",
          author,
          at: createdAt,
        },
        ...(resolved
          ? [
              {
                id: `${id}-status-resolved`,
                status: "resolved" as const,
                author: "林间工作室",
                at: createdAt + 30 * 60 * 1000,
              },
            ]
          : []),
      ],
    };
    return thread;
  };
  return [
    make(
      "demo-thread-1",
      1,
      {
        x: (page.panels[1]!.rect.x + 70) / page.width,
        y: (page.panels[1]!.rect.y + 40) / page.height,
        width: 190 / page.width,
        height: 130 / page.height,
      },
      "这里的雨丝方向反了：风从右往左，雨却往右飘，读起来会出戏。",
      "编辑 · 周遥",
      [
        {
          author: "林间工作室",
          body: "收到，这一格的雨线会按风向重画。",
          offset: 20 * 60 * 1000,
        },
        {
          author: "编辑 · 周遥",
          body: "重画后请保留原来的圈选位置，方便对照。",
          offset: 24 * 60 * 1000,
        },
      ],
      true,
    ),
    make(
      "demo-thread-2",
      2,
      {
        x: (page.panels[2]!.rect.x + 40) / page.width,
        y: (page.panels[2]!.rect.y + 60) / page.height,
        width: 150 / page.width,
        height: 110 / page.height,
      },
      "这封没有署名的消息，字迹可以再淡一点吗？想留一点“看不清”的悬念。",
      "编辑 · 周遥",
      [
        {
          author: "林间工作室",
          body: "可以，下一版把墨色降一档。",
          offset: 12 * 60 * 1000,
        },
      ],
      false,
    ),
  ].filter((t): t is ReviewThread => Boolean(t));
}
