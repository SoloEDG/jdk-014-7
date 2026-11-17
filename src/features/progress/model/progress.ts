import { ref, watch, computed, type Ref } from "vue";
import type {
  Bookmark,
  ComicDocument,
  ReadingLocation,
} from "../../../shared/document";
import { makeId } from "../../../shared/commands";
import { writeSession, type SavedSession } from "../lib/storage";
import { readingMetrics } from "../lib/metrics";
export function useProgress(
  doc: Ref<ComicDocument>,
  location: Ref<ReadingLocation>,
  /** 正式续读点；批注预览跳转不会写到它。 */
  resume: Ref<ReadingLocation>,
  saved: SavedSession | null,
) {
  const bookmarks = ref<Bookmark[]>(saved?.bookmarks ?? []),
    status = ref("本地自动保存已开启"),
    /** 进度与自动保存跟随正式续读点。 */
    metrics = computed(() => readingMetrics(doc.value, resume.value)),
    /** 页号显示跟随当前画面（含批注预览）。 */
    viewMetrics = computed(() => readingMetrics(doc.value, location.value));
  function save() {
    status.value = writeSession({
      document: doc.value,
      location: resume.value,
      bookmarks: bookmarks.value,
    });
  }
  watch([doc, resume, bookmarks], save, { deep: true });
  function add() {
    const target = location.value;
    const same = bookmarks.value.find(
      (b) =>
        b.location.pageId === target.pageId &&
        b.location.panelId === target.panelId,
    );
    if (same) {
      status.value = "此处分镜已收藏";
      return;
    }
    const c = doc.value.chapters.find((c) => c.id === target.chapterId);
    bookmarks.value.push({
      id: makeId("bookmark"),
      label: `${c?.title ?? "章节"} · 第 ${viewMetrics.value.pageIndex} 页`,
      location: { ...target },
      created: Date.now(),
    });
  }
  function remove(id: string) {
    bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
  }
  function reconcile() {
    const ids = new Set(
      doc.value.chapters.flatMap((c) => c.pages.map((p) => p.id)),
    );
    bookmarks.value = bookmarks.value.filter((b) => ids.has(b.location.pageId));
  }
  return { bookmarks, status, metrics, viewMetrics, add, remove, reconcile, save };
}
