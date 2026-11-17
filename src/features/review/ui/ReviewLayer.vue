<script setup lang="ts">
import { computed, ref } from "vue";
import { MessageSquarePlus, X, Move, Check } from "lucide-vue-next";
import type { ComicPage, Panel, ReadingMode } from "../../../shared/document";
import type { NormalizedRect, ReviewThread } from "../model/review";
import {
  overlayStyle,
  pointerToPage,
  normalizedSelection,
  panelAtRect,
  viewRegion,
} from "../lib/anchor";

const props = defineProps<{
  page: ComicPage;
  panel: Panel;
  mode: ReadingMode;
  threads: ReviewThread[];
  activeId: string;
  /** 圈选模式：拖拽即创建批注。 */
  selecting: boolean;
  /** 重新定位模式：拖拽更新指定讨论的圈选。 */
  relocating: string;
  staleIds: string[];
}>();
const emit = defineEmits<{
  select: [id: string];
  create: [rect: NormalizedRect, panelId: string];
  relocate: [id: string, rect: NormalizedRect];
  cancel: [];
  close: [];
}>();

const region = computed(() => viewRegion(props.page, props.panel, props.mode));
const layer = ref<HTMLElement>();
const draft = ref<NormalizedRect | null>(null);
let start: { x: number; y: number } | null = null;

function localPoint(e: PointerEvent) {
  const box = layer.value?.getBoundingClientRect();
  if (!box) return null;
  return pointerToPage(
    props.page,
    region.value,
    {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    },
    e.clientX,
    e.clientY,
  );
}

function down(e: PointerEvent) {
  if (!props.selecting && !props.relocating) return;
  const point = localPoint(e);
  if (!point) return;
  start = point;
  draft.value = { ...point, width: 0.002, height: 0.002 };
  try {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  } catch {
    /* 某些环境不支持指针捕获，不影响圈选。 */
  }
  e.preventDefault();
}

function move(e: PointerEvent) {
  if (!start) return;
  const point = localPoint(e);
  if (!point) return;
  draft.value = normalizedSelection(props.page, start, point);
}

function up() {
  if (!start || !draft.value) return;
  const rect = draft.value;
  const tiny = rect.width < 0.012 && rect.height < 0.012;
  start = null;
  draft.value = null;
  if (tiny) return;
  if (props.relocating) {
    emit("relocate", props.relocating, rect);
    return;
  }
  const chosen = panelAtRect(props.page, rect);
  emit("create", rect, chosen?.id ?? props.panel.id);
}

function markerStyle(thread: ReviewThread) {
  const target =
    thread.anchor.pageId === props.page.id ? thread.anchor.rect : null;
  return target ? overlayStyle(props.page, region.value, target) : null;
}

function isStale(id: string) {
  return props.staleIds.includes(id);
}

</script>

<template>
  <div
    ref="layer"
    class="review-layer"
    :class="{ selecting: selecting || relocating }"
    @pointerdown.stop="down"
    @pointermove.stop="move"
    @pointerup.stop="up"
    @pointercancel.stop="up"
    @dblclick.stop
  >
    <div
      v-for="thread in threads.filter(
        (t) =>
          t.anchor.pageId === page.id &&
          t.revisions.length > 0 &&
          (t.originalAnchor.rect.x !== t.anchor.rect.x ||
            t.originalAnchor.rect.y !== t.anchor.rect.y ||
            t.originalAnchor.rect.width !== t.anchor.rect.width ||
            t.originalAnchor.rect.height !== t.anchor.rect.height),
      )"
      :key="`${thread.id}-original`"
      class="review-original"
      :class="{ active: thread.id === activeId }"
      :style="overlayStyle(page, region, thread.originalAnchor.rect)"
    >
      <span>原圈选（证据）</span>
    </div>
    <button
      v-for="thread in threads.filter((t) => t.anchor.pageId === page.id).slice(0, 60)"
      :key="thread.id"
      class="review-marker"
      :class="{
        active: thread.id === activeId,
        resolved: thread.status === 'resolved',
        stale: isStale(thread.id),
      }"
      :style="markerStyle(thread) ?? undefined"
      :aria-label="`查看批注：${thread.body.slice(0, 24)}`"
      @pointerdown.stop
      @click.stop="emit('select', thread.id)"
    >
      <span class="review-marker-dot">{{ thread.replies.length || "" }}</span>
      <span class="review-marker-label">{{
        thread.status === "resolved" ? "已解决" : isStale(thread.id) ? "待重定位" : "讨论中"
      }}</span>
    </button>

    <div
      v-if="draft"
      class="review-draft"
      :style="overlayStyle(page, region, draft)"
    >
      <span class="review-draft-hint">
        <Move :size="11" /> 松开后写批注
      </span>
    </div>

    <div v-if="selecting || relocating" class="review-layer-tip">
      <MessageSquarePlus v-if="selecting" :size="13" />
      <Move v-else :size="13" />
      <span>{{ relocating ? "拖出新的圈选范围，重新定位这条批注" : "在画面上拖出想讨论的区域" }}</span>
      <button @pointerdown.stop @click.stop="emit('cancel')">
        <X :size="13" /> 取消
      </button>
    </div>
  </div>
</template>
