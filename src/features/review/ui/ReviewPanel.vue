<script setup lang="ts">
import { ref } from "vue";
import {
  MessageSquare,
  Check,
  RotateCcw,
  Crosshair,
  History,
  Send,
  Download,
  Upload,
  ChevronDown,
  ChevronUp,
  CircleDot,
  AlertTriangle,
  X,
} from "lucide-vue-next";
import type { ReviewThread } from "../model/review";
import { formatBytes, formatTime } from "../lib/packet";
import type { PacketReport } from "../lib/packet";
import type { ReviewNotice } from "../model/reviewStore";

const props = defineProps<{
  threads: ReviewThread[];
  counts: { total: number; open: number; resolved: number; stale: number };
  filter: "all" | "open" | "resolved" | "stale";
  activeId: string;
  viewer: string;
  open: boolean;
  staleIds: string[];
  notice: ReviewNotice | null;
  packetLimit: number;
  packetBusy: boolean;
  exportReport: PacketReport | null;
  relocating: string;
}>();
const emit = defineEmits<{
  filter: [value: "all" | "open" | "resolved" | "stale"];
  focus: [id: string];
  reply: [id: string, body: string];
  status: [id: string, status: "open" | "resolved"];
  relocate: [id: string];
  cancelRelocate: [];
  viewer: [name: string];
  limit: [bytes: number];
  export: [];
  import: [files: File[]];
  toggle: [];
}>();

const drafts = ref<Record<string, string>>({});
// 默认展开回复：合并回来的离线回复应当一眼可见。
const collapsed = ref<Record<string, boolean>>({});
const limitOpen = ref(false);
const viewerEditing = ref(false);
const viewerDraft = ref(props.viewer);

function send(thread: ReviewThread) {
  const body = (drafts.value[thread.id] ?? "").trim();
  if (!body) return;
  emit("reply", thread.id, body);
  drafts.value = { ...drafts.value, [thread.id]: "" };
}

function isStale(id: string) {
  return props.staleIds.includes(id);
}

function revisionText(thread: ReviewThread) {
  const first = thread.originalAnchor.rect,
    latest = thread.anchor.rect;
  return `${Math.round(first.width * 100)}%×${Math.round(first.height * 100)}% → ${Math.round(latest.width * 100)}%×${Math.round(latest.height * 100)}%`;
}

function pickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length) emit("import", files);
  input.value = "";
}

const limitPresets = [64, 128, 256, 512, 1024];

/** 显示名：合并回来的讨论可能来自不同审阅者。 */
function shortAuthor(name: string) {
  return name.length > 12 ? `${name.slice(0, 12)}…` : name;
}
</script>

<template>
  <section class="review-panel" :class="{ compact: !open }">
    <div class="review-panel-head">
      <span
        ><MessageSquare :size="14" /> 批注讨论
        <b class="review-count">{{ counts.open }}</b></span
      >
      <button class="review-collapse" :title="open ? '收起批注' : '展开批注'" @click="emit('toggle')">
        <ChevronDown v-if="open" :size="15" /><ChevronUp v-else :size="15" />
      </button>
    </div>
    <template v-if="open">
      <div class="review-filters">
        <button
          v-for="item in [
            { key: 'all', label: '全部', n: counts.total },
            { key: 'open', label: '进行中', n: counts.open },
            { key: 'resolved', label: '已解决', n: counts.resolved },
            { key: 'stale', label: '待重定位', n: counts.stale },
          ]"
          :key="item.key"
          :class="{ active: filter === item.key }"
          @click="emit('filter', item.key as 'all' | 'open' | 'resolved' | 'stale')"
        >
          {{ item.label }}<small>{{ item.n }}</small>
        </button>
      </div>

      <div class="review-list">
        <p v-if="!threads.length" class="review-empty">
          <CircleDot :size="20" />
          画面上拖出区域，留下第一条批注。
        </p>
        <article
          v-for="thread in threads"
          :key="thread.id"
          class="review-thread"
          :class="{
            active: thread.id === activeId,
            resolved: thread.status === 'resolved',
            stale: isStale(thread.id),
          }"
        >
          <button class="review-thread-head" @click="emit('focus', thread.id)">
            <span class="review-anchor-chip">
              <Crosshair :size="11" />{{ thread.anchor.context.panelLabel }}
            </span>
            <span class="review-meta">
              {{ thread.author }} · {{ formatTime(thread.createdAt) }}
            </span>
            <span v-if="thread.status === 'resolved'" class="review-state done"
              ><Check :size="11" /> 已解决</span
            >
            <span v-else-if="isStale(thread.id)" class="review-state warn"
              ><AlertTriangle :size="11" /> 分镜已重裁</span
            >
            <span v-else class="review-state"><CircleDot :size="11" /> 讨论中</span>
          </button>
          <p class="review-body">{{ thread.body }}</p>
          <p class="review-context">
            {{ thread.anchor.context.chapterTitle }} / {{ thread.anchor.context.pageTitle }}
            <span>「{{ thread.anchor.context.dialogue }}」</span>
          </p>

          <button
            v-if="thread.replies.length"
            class="review-expand"
            @click="collapsed = { ...collapsed, [thread.id]: !collapsed[thread.id] }"
          >
            {{ collapsed[thread.id] ? "展开" : "收起" }} {{ thread.replies.length }} 条回复
          </button>
          <div
            v-if="thread.replies.length && !collapsed[thread.id]"
            class="review-replies"
          >
            <div v-for="item in thread.replies" :key="item.id" class="review-reply">
              <span>{{ shortAuthor(item.author) }}</span>
              <p>{{ item.body }}</p>
              <small>{{ formatTime(item.createdAt) }}</small>
            </div>
          </div>

          <div v-if="isStale(thread.id)" class="review-relocate">
            <div>
              <strong>作者重裁了这个分镜</strong>
              <small>原圈选 {{ revisionText(thread) }} 仍保留为证据</small>
            </div>
            <button
              v-if="relocating !== thread.id"
              class="review-ghost"
              @click="emit('relocate', thread.id)"
            >
              <Crosshair :size="12" /> 重新定位
            </button>
            <button v-else class="review-ghost on" @click="emit('cancelRelocate')">
              <X :size="12" /> 退出定位
            </button>
          </div>

          <div v-if="thread.revisions.length" class="review-revisions">
            <span><History :size="11" /> 已重新定位 {{ thread.revisions.length }} 次</span>
            <small v-for="rev in thread.revisions.slice(-2)" :key="rev.id">
              {{ formatTime(rev.createdAt) }} · {{ shortAuthor(rev.author) }} ·
              {{ rev.reason === "recrop" ? "重裁后定位" : "手动定位" }}
            </small>
          </div>

          <div class="review-reply-box">
            <input
              v-model="drafts[thread.id]"
              :aria-label="`回复 ${thread.author} 的批注`"
              placeholder="在原位置回复…"
              maxlength="2000"
              @keydown.enter="send(thread)"
            />
            <button
              :disabled="!(drafts[thread.id] ?? '').trim()"
              :title="`回复 ${thread.author}`"
              @click="send(thread)"
            >
              <Send :size="12" />
            </button>
          </div>
          <div class="review-actions">
            <button
              v-if="thread.status === 'open'"
              @click="emit('status', thread.id, 'resolved')"
            >
              <Check :size="12" /> 解决
            </button>
            <button v-else @click="emit('status', thread.id, 'open')">
              <RotateCcw :size="12" /> 重新打开
            </button>
          </div>
        </article>
      </div>

      <div class="review-exchange">
        <div class="review-exchange-head">
          <span>离线交换</span>
          <button @click="emit('export')"><Download :size="12" /> 导出审阅包</button>
        </div>
        <p v-if="exportReport?.limited" class="review-report">
          上次导出 {{ formatBytes(exportReport.bytes) }} / 上限
          {{ formatBytes(exportReport.limitBytes) }}，已截断：
          {{ exportReport.notes.join(" ") }}
        </p>
        <p v-else-if="exportReport" class="review-report">
          上次导出 {{ formatBytes(exportReport.bytes) }}，包含
          {{ exportReport.includedThreads }} 条讨论。
        </p>
        <div class="review-limit">
          <button class="review-limit-toggle" @click="limitOpen = !limitOpen">
            文件大小上限 {{ formatBytes(packetLimit) }}
            <ChevronDown v-if="!limitOpen" :size="12" /><ChevronUp v-else :size="12" />
          </button>
          <div v-if="limitOpen" class="review-limit-presets">
            <button
              v-for="kb in limitPresets"
              :key="kb"
              :class="{ active: packetLimit === kb * 1024 }"
              @click="emit('limit', kb * 1024)"
            >
              {{ kb }} KB
            </button>
          </div>
        </div>
        <label class="review-import">
          <Upload :size="12" /> {{ packetBusy ? "正在合并…" : "合并审阅包" }}
          <input
            type="file"
            accept=".json,application/json"
            aria-label="合并审阅包"
            :disabled="packetBusy"
            @change="pickFiles"
          />
        </label>
        <p v-if="notice" class="review-notice" :class="notice.tone" role="status">
          {{ notice.text }}
        </p>
        <div class="review-viewer">
          <span v-if="!viewerEditing">身份：{{ viewer }}</span>
          <input
            v-else
            v-model="viewerDraft"
            maxlength="40"
            aria-label="审阅者名字"
            @keydown.enter="emit('viewer', viewerDraft); viewerEditing = false"
          />
          <button
            @click="
              viewerEditing
                ? (emit('viewer', viewerDraft), (viewerEditing = false))
                : ((viewerDraft = viewer), (viewerEditing = true))
            "
          >
            {{ viewerEditing ? "保存" : "修改" }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
