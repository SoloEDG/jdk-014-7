import { ref, computed, type Ref } from "vue";
import type {
  ComicDocument,
  ReadingLocation,
  ReadingMode,
} from "../../../shared/document";
import type { ReaderCommand } from "../../../shared/commands";
import { firstLocation, resolveLocation } from "../../../shared/lookup";
import { normalize, advance } from "../lib/navigation";
import { constrainPan } from "../lib/viewport";

export interface ReviewTarget {
  chapterId: string;
  pageId: string;
  panelId: string;
}

export function useReader(doc: Ref<ComicDocument>) {
  const first = firstLocation(doc.value);
  const location = ref<ReadingLocation>(first),
    mode = ref<ReadingMode>("page"),
    /** 正式续读点：只由普通阅读操作推进，批注浏览不会改写它。 */
    resume = ref<ReadingLocation>({ ...first }),
    /** 当前是否处于“批注预览”，用于区分临时跳转与正式阅读。 */
    reviewing = ref(false);
  const current = computed(() => resolveLocation(doc.value, location.value));

  function commit(at: ReadingLocation) {
    location.value = normalize(doc.value, at);
    if (!reviewing.value) resume.value = { ...location.value };
  }

  function dispatch(command: ReaderCommand) {
    reviewing.value = false;
    let at = { ...location.value };
    if (command.type === "move")
      at = advance(doc.value, at, command.delta, mode.value);
    if (command.type === "chapter") {
      const c = doc.value.chapters.find((c) => c.id === command.id);
      at = {
        chapterId: c?.id ?? "",
        pageId: c?.pages[0]?.id ?? "",
        panelId: c?.pages[0]?.panels[0]?.id ?? "",
        zoom: 1,
        x: 0,
        y: 0,
      };
    }
    if (command.type === "panel") {
      at.panelId = command.id;
      at.zoom = 1;
      at.x = at.y = 0;
    }
    if (command.type === "restore") at = { ...command.location };
    commit(at);
  }

  /** 批注跳转：只移动视图，不改变正式续读点。 */
  function reveal(target: ReviewTarget) {
    reviewing.value = true;
    const base = { ...location.value };
    location.value = normalize(doc.value, {
      ...base,
      chapterId: target.chapterId,
      pageId: target.pageId,
      panelId: target.panelId,
      zoom: 1,
      x: 0,
      y: 0,
    });
  }

  /** 回到正式续读点。 */
  function restoreResume() {
    reviewing.value = false;
    location.value = { ...resume.value };
  }

  function reconcile() {
    location.value = normalize(doc.value, location.value);
    resume.value = normalize(doc.value, resume.value);
  }

  function zoom(delta: number) {
    location.value.zoom = Math.max(
      1,
      Math.min(3, Math.round((location.value.zoom + delta) * 10) / 10),
    );
    Object.assign(
      location.value,
      constrainPan(location.value.x, location.value.y, location.value.zoom),
    );
    if (!reviewing.value) resume.value = { ...location.value };
  }

  function pan(x: number, y: number) {
    Object.assign(location.value, constrainPan(x, y, location.value.zoom));
    if (!reviewing.value) resume.value = { ...location.value };
  }

  function setMode(value: ReadingMode) {
    mode.value = value;
  }

  return {
    location,
    resume,
    reviewing,
    mode,
    current,
    dispatch,
    reveal,
    restoreResume,
    reconcile,
    zoom,
    pan,
    setMode,
  };
}

export type Reader = ReturnType<typeof useReader>;
