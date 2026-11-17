<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-vue-next";
import type {
  ComicPage,
  Panel,
  ReadingLocation,
  ReadingMode,
} from "../../../shared/document";
import { frameStyle } from "../lib/viewport";
import ReviewLayer from "../../review/ui/ReviewLayer.vue";
import type {
  NormalizedRect,
  ReviewThread,
} from "../../review/model/review";
import { viewRegion } from "../../review/lib/anchor";
const props = defineProps<{
  page: ComicPage;
  panel: Panel;
  location: ReadingLocation;
  mode: ReadingMode;
  threads: ReviewThread[];
  activeReviewId: string;
  selecting: boolean;
  relocating: string;
  staleIds: string[];
}>();
const emit = defineEmits<{
  move: [delta: number];
  pan: [x: number, y: number];
  panel: [id: string];
  selectReview: [id: string];
  createReview: [rect: NormalizedRect, panelId: string];
  relocateReview: [id: string, rect: NormalizedRect];
  cancelReview: [];
}>();
const stage = ref<HTMLElement>();
let drag: { x: number; y: number; px: number; py: number } | null = null;
const interactive = computed(() => props.selecting || Boolean(props.relocating));

/** 逐格模式下只显示与当前分镜相交的圈选；整页模式显示本页全部。 */
const visibleThreads = computed(() => {
  const region = viewRegion(props.page, props.panel, props.mode);
  const onPage = props.threads.filter((t) => t.anchor.pageId === props.page.id);
  if (props.mode === "page") return onPage;
  return onPage.filter((thread) => {
    const rect = thread.anchor.rect;
    const ax = rect.x * props.page.width,
      ay = rect.y * props.page.height,
      bx = (rect.x + rect.width) * props.page.width,
      by = (rect.y + rect.height) * props.page.height;
    return (
      bx >= region.x &&
      ax <= region.x + region.width &&
      by >= region.y &&
      ay <= region.y + region.height
    );
  });
});

function down(e: PointerEvent) {
  if (interactive.value) return;
  if (props.location.zoom <= 1) return;
  drag = {
    x: e.clientX,
    y: e.clientY,
    px: props.location.x,
    py: props.location.y,
  };
  try {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  } catch {
    /* 忽略不支持的指针捕获。 */
  }
}
function move(e: PointerEvent) {
  if (drag)
    emit("pan", drag.px + e.clientX - drag.x, drag.py + e.clientY - drag.y);
}
function fullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.value?.requestFullscreen();
}
</script>
<template>
  <section ref="stage" class="reader-stage">
    <div class="stage-grain"></div>
    <div class="stage-topline">
      <span><i></i> IMMERSIVE READING</span
      ><button title="全屏阅读" @click="fullscreen">
        <Maximize2 :size="16" />
      </button>
    </div>
    <button
      class="nav-arrow previous"
      aria-label="上一页或分镜"
      @click="emit('move', -1)"
    >
      <ChevronLeft :size="23" />
    </button>
    <div
      class="comic-frame"
      :class="{ focused: mode === 'panel', annotating: interactive }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="drag = null"
      @pointercancel="drag = null"
    >
      <div
        class="comic-image"
        :style="{
          ...frameStyle(page, panel, mode),
          transform: `translate(${location.x}px, ${location.y}px) scale(${location.zoom})`,
        }"
      >
        <template v-if="mode === 'page'"
          ><button
            v-for="(p, i) in page.panels"
            :key="p.id"
            class="panel-hotspot"
            :style="{
              left: `${(p.rect.x / page.width) * 100}%`,
              top: `${(p.rect.y / page.height) * 100}%`,
              width: `${(p.rect.width / page.width) * 100}%`,
              height: `${(p.rect.height / page.height) * 100}%`,
            }"
            :aria-label="`阅读分镜 ${i + 1}`"
            @dblclick="emit('panel', p.id)"
          >
            <span>{{ String(i + 1).padStart(2, "0") }}</span>
          </button></template
        >
        <ReviewLayer
          :page="page"
          :panel="panel"
          :mode="mode"
          :threads="visibleThreads"
          :active-id="activeReviewId"
          :selecting="selecting"
          :relocating="relocating"
          :stale-ids="staleIds"
          @select="emit('selectReview', $event)"
          @create="(rect, panelId) => emit('createReview', rect, panelId)"
          @relocate="(id, rect) => emit('relocateReview', id, rect)"
          @cancel="emit('cancelReview')"
        />
      </div>
    </div>
    <button
      class="nav-arrow next"
      aria-label="下一页或分镜"
      @click="emit('move', 1)"
    >
      <ChevronRight :size="23" />
    </button>
    <div class="stage-caption">
      <span
        >{{ mode === "page" ? "整页浏览" : "逐格沉浸" }} <b>·</b>
        {{ page.title }}</span
      ><span>{{
        interactive
          ? "拖拽圈选 · 松开完成"
          : "← → 翻阅 · 双击分镜进入 · 点批注查看"
      }}</span>
    </div>
  </section>
</template>
