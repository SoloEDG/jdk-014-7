<script setup lang="ts">
import { computed } from "vue";
import type { ComicPage } from "../../../shared/document";
import { frameStyle } from "../lib/viewport";
import type { ReviewThread } from "../../review/model/review";
const props = defineProps<{
  page: ComicPage;
  active: string;
  threads: ReviewThread[];
  staleIds: string[];
}>();
const emit = defineEmits<{ select: [id: string] }>();
/** 每个分镜上的批注数，用于分镜导航与讨论联动。 */
const reviewCounts = computed(() => {
  const map = new Map<string, { count: number; open: number; stale: number }>();
  for (const thread of props.threads) {
    if (thread.anchor.pageId !== props.page.id) continue;
    const entry = map.get(thread.anchor.panelId) ?? {
      count: 0,
      open: 0,
      stale: 0,
    };
    entry.count++;
    if (thread.status === "open") entry.open++;
    if (props.staleIds.includes(thread.id)) entry.stale++;
    map.set(thread.anchor.panelId, entry);
  }
  return map;
});
</script>
<template>
  <section class="panel-strip">
    <div class="section-heading">
      <span>分镜导航 <small>STORYBOARD</small></span
      ><span class="muted">{{ page.panels.length }} 个镜头</span>
    </div>
    <div class="panel-thumbs">
      <button
        v-for="(panel, i) in page.panels"
        :key="panel.id"
        :class="{ selected: active === panel.id }"
        @click="emit('select', panel.id)"
      >
        <div :style="frameStyle(page, panel, 'panel')">
          <span
            v-if="reviewCounts.get(panel.id)"
            class="thumb-review-badge"
            :class="{ stale: reviewCounts.get(panel.id)!.stale > 0 }"
            :title="`${reviewCounts.get(panel.id)!.count} 条批注`"
          >
            {{ reviewCounts.get(panel.id)!.count }}
          </span>
        </div>
        <span
          ><b>{{ String(i + 1).padStart(2, "0") }}</b> {{ panel.speaker }}
          <small>{{ panel.duration }}s</small></span
        >
      </button>
    </div>
  </section>
</template>
