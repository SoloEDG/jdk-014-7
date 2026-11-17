<script setup lang="ts">
import { computed, watch } from "vue";
import {
  BookOpen,
  ChevronRight,
  Grid2X2,
  Scan,
  Minus,
  Plus,
  Bookmark,
  Cloud,
  PanelLeftClose,
  MessageSquarePlus,
  CornerDownRight,
} from "lucide-vue-next";
import { LibraryPanel } from "../features/library";
import { ChapterPanel } from "../features/chapters";
import { ReaderStage, PanelStrip } from "../features/reader";
import { AudioPanel } from "../features/audio";
import { ProgressPanel } from "../features/progress";
import { ReviewPanel, ReviewComposer, RecropTool } from "../features/review";
import { useWorkspace } from "./workspace";
const {
  doc,
  reader: r,
  progress: p,
  library: l,
  chapters: c,
  audio: a,
  review: v,
} = useWorkspace();
const current = r.current,
  at = r.location,
  mode = r.mode,
  metrics = p.metrics,
  viewMetrics = p.viewMetrics,
  bookmarks = p.bookmarks,
  status = p.status,
  cue = a.cue;
const chapterIndex = computed(
  () => doc.value.chapters.findIndex((c) => c.id === at.value.chapterId) + 1,
);
watch(
  () => current.value.page?.id,
  (id) => {
    if (id) v.setCurrentPage(id);
  },
  { immediate: true },
);
function focus(id: string) {
  r.dispatch({ type: "panel", id });
  r.setMode("panel");
}
function importReview(files: File[]) {
  const file = files[0];
  if (file) void v.importPacket(file);
}
function exportReviews() {
  v.exportPacket({
    documentTitle: doc.value.title,
    exporter: v.viewer.value,
  });
}
const composerModeLabel = computed(() =>
  mode.value === "page" ? "整页模式" : "逐格模式",
);
const reviewHint = computed(() => {
  if (v.selecting.value) return "圈选中";
  if (v.relocating.value) return "重新定位中";
  if (r.reviewing.value) return "批注预览";
  return "";
});
</script>
<template>
  <div class="app-shell">
    <header class="app-header">
      <a class="brand" href="./"
        ><div class="brand-icon"><BookOpen :size="22" /></div>
        <strong>PANEL<span>沉浸漫画</span></strong></a
      >
      <nav>
        <span>我的书架</span><ChevronRight :size="13" /><strong>{{
          doc.title
        }}</strong
        ><span class="preview-tag">正在阅读</span>
      </nav>
      <div class="header-right">
        <Cloud :size="15" /><span>本地已就绪</span>
        <div class="avatar">{{ v.viewer.value.slice(0, 1) || "林" }}</div>
      </div>
    </header>
    <div class="workspace">
      <aside class="left-sidebar">
        <div class="book-cover">
          <img :src="doc.chapters[0]?.pages[0]?.image" alt="雨停之前漫画封面" />
          <div>
            <small>ORIGINAL COMIC</small>
            <h1>{{ doc.title }}</h1>
            <p>{{ doc.author }} 著</p>
          </div>
          <span>全彩 · 沉浸版</span>
        </div>
        <div class="book-details">
          <h2>{{ doc.title }} <span>连载中</span></h2>
          <p>当城市沉睡，故事才刚刚开始。</p>
          <div><span>都市悬疑</span><span>氛围叙事</span></div>
        </div>
        <ChapterPanel
          :chapters="doc.chapters"
          :active="at.chapterId"
          :editing="c.editing.value"
          :draft="c.draft.value"
          :error="c.error.value"
          @select="r.dispatch({ type: 'chapter', id: $event })"
          @rename="c.begin"
          @move="c.move"
          @remove="c.remove"
          @draft="c.draft.value = $event"
          @save="c.rename"
        /><LibraryPanel
          :busy="l.busy.value"
          :message="l.message.value"
          @import="l.importFiles"
          @reset="l.reset"
        />
        <div class="sidebar-footer">
          <PanelLeftClose :size="14" /> 你的私人漫画放映室 <span>v1.0</span>
        </div>
      </aside>
      <main class="reading-workspace">
        <div class="reader-toolbar">
          <div>
            <span class="chapter-eyebrow"
              >CHAPTER {{ String(chapterIndex).padStart(2, "0") }}</span
            >
            <h2>{{ current.chapter?.title }}</h2>
          </div>
          <div class="reader-tools">
            <div class="mode-switch">
              <button
                :class="{ active: mode === 'page' }"
                @click="r.setMode('page')"
              >
                <Grid2X2 :size="14" /> 整页</button
              ><button
                :class="{ active: mode === 'panel' }"
                @click="r.setMode('panel')"
              >
                <Scan :size="14" /> 逐格
              </button>
            </div>
            <span class="tool-divider"></span
            ><button aria-label="缩小" @click="r.zoom(-0.2)">
              <Minus :size="15" /></button
            ><span class="zoom-value">{{ Math.round(at.zoom * 100) }}%</span
            ><button aria-label="放大" @click="r.zoom(0.2)">
              <Plus :size="15" /></button
            ><button title="收藏当前分镜" @click="p.add">
              <Bookmark :size="16" /></button
            ><button
              class="annotate-button"
              :class="{ on: v.selecting.value }"
              title="在画面上圈选批注"
              @click="v.selecting.value ? v.cancelSelection() : v.beginSelection()"
            >
              <MessageSquarePlus :size="16" />
              <span v-if="v.counts.value.open" class="annotate-count">{{
                v.counts.value.open
              }}</span>
            </button>
          </div>
        </div>
        <div
          v-if="reviewHint"
          class="review-mode-banner"
          :class="{ preview: r.reviewing.value && !v.selecting.value && !v.relocating.value }"
        >
          <span>
            <MessageSquarePlus v-if="v.selecting.value" :size="13" />
            <CornerDownRight v-else-if="v.relocating.value" :size="13" />
            <Bookmark v-else :size="13" />
            {{ reviewHint }}
            <template v-if="r.reviewing.value">
              · 仅预览批注位置，正式续读点未改变
            </template>
          </span>
          <button
            v-if="r.reviewing.value"
            @click="v.resumeReading()"
          >
            回到续读点
          </button>
          <button
            v-if="v.selecting.value || v.relocating.value"
            @click="v.cancelSelection()"
          >
            取消圈选
          </button>
        </div>
        <ReaderStage
          v-if="current.page && current.panel"
          :page="current.page"
          :panel="current.panel"
          :location="at"
          :mode="mode"
          :threads="v.threads.value"
          :active-review-id="v.activeId.value"
          :selecting="v.selecting.value"
          :relocating="v.relocating.value"
          :stale-ids="v.staleIds.value"
          @move="r.dispatch({ type: 'move', delta: $event })"
          @pan="r.pan"
          @panel="focus"
          @select-review="v.focusThread"
          @create-review="v.takeSelection"
          @relocate-review="v.relocate"
          @cancel-review="v.cancelSelection"
        />
        <RecropTool
          v-if="current.page && current.panel"
          :page="current.page"
          :panel="current.panel"
          :threads="v.threads.value"
          @recrop="v.recropPanel"
        />
        <div class="page-position">
          <span>{{ current.chapter?.subtitle }}</span>
          <div>
            <b>{{ String(viewMetrics.pageIndex).padStart(2, "0") }}</b
            ><span>/ {{ String(viewMetrics.pageCount).padStart(2, "0") }}</span
            ><small>页</small>
          </div>
          <span>阅读位置自动保存 <i></i></span>
        </div>
        <PanelStrip
          v-if="current.page"
          :page="current.page"
          :active="at.panelId"
          :threads="v.threads.value"
          :stale-ids="v.staleIds.value"
          @select="focus"
        />
      </main>
      <aside class="right-sidebar">
        <AudioPanel
          :enabled="a.enabled.value"
          :volume="a.volume.value"
          :dialogue="a.dialogue.value"
          :cue="cue"
          :error="a.error.value"
          @toggle="a.toggle"
          @volume="a.volume.value = $event"
          @dialogue="a.dialogue.value = !a.dialogue.value"
        /><ProgressPanel
          :bookmarks="bookmarks"
          :percent="metrics.percent"
          :status="status"
          @add="p.add"
          @remove="p.remove"
          @restore="r.dispatch({ type: 'restore', location: $event })"
        />
        <ReviewPanel
          :threads="v.visible.value"
          :counts="v.counts.value"
          :filter="v.filter.value"
          :active-id="v.activeId.value"
          :viewer="v.viewer.value"
          :open="v.open.value"
          :stale-ids="v.staleIds.value"
          :notice="v.notice.value"
          :packet-limit="v.packetLimit.value"
          :packet-busy="v.packetBusy.value"
          :export-report="v.exportReport.value"
          :relocating="v.relocating.value"
          @filter="v.filter.value = $event"
          @focus="v.focusThread"
          @reply="v.reply"
          @status="v.setStatus"
          @relocate="v.beginRelocate"
          @cancel-relocate="v.cancelSelection"
          @viewer="v.setViewer"
          @limit="v.setPacketLimit"
          @export="exportReviews"
          @import="importReview"
          @toggle="v.open.value = !v.open.value"
        />
        <div class="reading-tip">
          <span>✦ 审阅小贴士</span>
          <p>圈选会自动记录分镜与对白。<br />导出的审阅包可以离线转交作者。</p>
          <kbd>←</kbd><kbd>→</kbd> <small>切换画面</small><br /><kbd>Space</kbd>
          <small>播放 / 暂停声景</small>
        </div>
      </aside>
    </div>
    <ReviewComposer
      :open="v.pending.value !== null"
      :rect="v.pending.value?.rect ?? null"
      :panel-id="v.pending.value?.panelId ?? ''"
      :context="v.pendingContext.value"
      :mode-label="composerModeLabel"
      @save="v.create"
      @cancel="v.cancelSelection"
    />
    <footer class="app-footer">
      <span><i></i> 所有故事，都有回声。</span
      ><span>PANEL · 为每一格想象而生</span
      ><span>图片导入 · 本地存储 · 无需联网</span>
    </footer>
  </div>
</template>
