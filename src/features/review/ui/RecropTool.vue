<script setup lang="ts">
import { computed, ref } from "vue";
import { Crop, RotateCcw, X } from "lucide-vue-next";
import type { ComicPage, Panel } from "../../../shared/document";
import { anchorIsStale } from "../lib/anchor";
import type { ReviewThread } from "../model/review";

const props = defineProps<{
  page: ComicPage;
  panel: Panel;
  threads: ReviewThread[];
}>();
const emit = defineEmits<{ recrop: [pageId: string, panelId: string, rect: { x: number; y: number; width: number; height: number }] }>();

const open = ref(false);
const draft = ref({
  x: props.panel.rect.x,
  y: props.panel.rect.y,
  width: props.panel.rect.width,
  height: props.panel.rect.height,
});

function begin() {
  draft.value = { ...props.panel.rect };
  open.value = true;
}
function reset() {
  draft.value = { ...props.panel.rect };
}
function apply() {
  const rect = {
    x: Math.max(0, Math.min(props.page.width - 8, Math.round(draft.value.x))),
    y: Math.max(0, Math.min(props.page.height - 8, Math.round(draft.value.y))),
    width: Math.max(8, Math.round(draft.value.width)),
    height: Math.max(8, Math.round(draft.value.height)),
  };
  emit("recrop", props.page.id, props.panel.id, rect);
  open.value = false;
}
const affected = computed(() =>
  props.threads.filter((thread) => {
    if (thread.anchor.pageId !== props.page.id) return false;
    return (
      thread.anchor.panelId === props.panel.id ||
      anchorIsStale(thread.anchor, props.page)
    );
  }),
);
</script>

<template>
  <div class="recrop-tool">
    <button
      class="recrop-toggle"
      :class="{ on: open }"
      title="模拟作者重裁当前分镜"
      @click="open ? (open = false) : begin()"
    >
      <Crop :size="12" /> 重裁分镜
      <small v-if="affected.length">{{ affected.length }} 条批注会待重定位</small>
    </button>
    <div v-if="open" class="recrop-form">
      <div class="recrop-fields">
        <label>X<input v-model.number="draft.x" type="number" min="0" aria-label="分镜 X" /></label>
        <label>Y<input v-model.number="draft.y" type="number" min="0" aria-label="分镜 Y" /></label>
        <label>宽<input v-model.number="draft.width" type="number" min="8" aria-label="分镜宽" /></label>
        <label>高<input v-model.number="draft.height" type="number" min="8" aria-label="分镜高" /></label>
      </div>
      <p>重裁后，相关批注会标记为「待重定位」，原圈选仍保留为证据。</p>
      <div class="recrop-actions">
        <button @click="reset"><RotateCcw :size="11" /> 重置</button>
        <button class="recrop-apply" @click="apply">应用重裁</button>
        <button @click="open = false"><X :size="11" /> 取消</button>
      </div>
    </div>
  </div>
</template>
