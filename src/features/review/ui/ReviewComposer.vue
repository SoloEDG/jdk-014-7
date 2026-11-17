<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PenLine, X, MapPin, Send } from "lucide-vue-next";
import type { NormalizedRect } from "../model/review";
import type { AnchorContext } from "../model/review";

const props = defineProps<{
  open: boolean;
  rect: NormalizedRect | null;
  panelId: string;
  context: AnchorContext | null;
  /** 逐格模式下圈选可能跨出当前分镜。 */
  modeLabel: string;
}>();
const emit = defineEmits<{
  save: [body: string];
  cancel: [];
}>();
const body = ref("");
const field = ref<HTMLTextAreaElement>();
watch(
  () => props.open,
  (open) => {
    if (open) {
      body.value = "";
      requestAnimationFrame(() => field.value?.focus());
    }
  },
);
const canSave = computed(() => body.value.trim().length > 0);
</script>

<template>
  <div v-if="open && rect" class="review-composer" role="dialog" aria-label="新建批注">
    <div class="review-composer-head">
      <span><PenLine :size="13" /> 新建批注</span>
      <button title="关闭" @click="emit('cancel')"><X :size="14" /></button>
    </div>
    <div class="review-composer-context">
      <MapPin :size="12" />
      <div>
        <strong>{{ context?.panelLabel || "未命名分镜" }}</strong>
        <small>{{ modeLabel }} · 圈选 {{ Math.round(rect.width * 100) }}% × {{ Math.round(rect.height * 100) }}% 画面</small>
      </div>
    </div>
    <blockquote v-if="context?.dialogue" class="review-composer-quote">
      “{{ context.dialogue }}”
      <small>— {{ context.speaker }}</small>
    </blockquote>
    <textarea
      ref="field"
      v-model="body"
      aria-label="批注内容"
      maxlength="2000"
      rows="4"
      placeholder="圈出的地方想改什么？写下你的意见…"
      @keydown.ctrl.enter="canSave && emit('save', body)"
      @keydown.meta.enter="canSave && emit('save', body)"
    ></textarea>
    <div class="review-composer-foot">
      <small>会同时记录当前分镜与对白</small>
      <div>
        <button class="review-ghost" @click="emit('cancel')">取消</button>
        <button class="review-primary" :disabled="!canSave" @click="emit('save', body)">
          <Send :size="12" /> 留下批注
        </button>
      </div>
    </div>
  </div>
</template>
