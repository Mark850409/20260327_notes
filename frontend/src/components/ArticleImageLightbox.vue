<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 文章正文容器（內含 img） */
    containerSelector?: string;
  }>(),
  {
    containerSelector: '#article-body-content',
  },
);

const open = ref(false);
const index = ref(0);
const items = ref<{ src: string; alt: string }[]>([]);
const cleanupFns: Array<() => void> = [];

function bind() {
  const root = document.querySelector<HTMLElement>(props.containerSelector);
  if (!root) return;

  const imgs = root.querySelectorAll<HTMLImageElement>('img');
  const validImgs: HTMLImageElement[] = [];
  imgs.forEach((el) => {
    const src = el.currentSrc || el.src;
    if (!src || src.startsWith('data:')) return;
    validImgs.push(el);
  });

  items.value = validImgs.map((el) => ({
    src: el.currentSrc || el.src,
    alt: el.alt || 'image',
  }));

  if (!validImgs.length) return;

  validImgs.forEach((el, i) => {
    el.classList.add('cursor-zoom-in', 'transition-opacity', 'hover:opacity-90');
    el.setAttribute('title', '點擊放大瀏覽');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');

    const onClick = (e: Event) => {
      e.preventDefault();
      index.value = i;
      open.value = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e);
      }
    };

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    cleanupFns.push(() => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKey);
      el.classList.remove('cursor-zoom-in', 'transition-opacity', 'hover:opacity-90');
      el.removeAttribute('title');
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
    });
  });
}

function unbind() {
  cleanupFns.splice(0).forEach((fn) => fn());
  items.value = [];
}

function close() {
  open.value = false;
}

function prev() {
  if (items.value.length <= 1) return;
  index.value = (index.value - 1 + items.value.length) % items.value.length;
}

function next() {
  if (items.value.length <= 1) return;
  index.value = (index.value + 1) % items.value.length;
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prev();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    next();
  }
}

let bodyOverflow = '';

watch(open, (v) => {
  if (typeof document === 'undefined') return;
  if (v) {
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = bodyOverflow;
  }
});

function scheduleBind() {
  unbind();
  nextTick(() => bind());
}

let timer1: ReturnType<typeof setTimeout> | undefined;
let timer2: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  scheduleBind();
  window.addEventListener('keydown', onGlobalKeydown);
  timer1 = setTimeout(scheduleBind, 120);
  timer2 = setTimeout(scheduleBind, 500);
});

onUnmounted(() => {
  if (timer1) clearTimeout(timer1);
  if (timer2) clearTimeout(timer2);
  window.removeEventListener('keydown', onGlobalKeydown);
  unbind();
  document.body.style.overflow = bodyOverflow;
});
</script>

<template>
  <!-- 不使用 Teleport：避免 Astro SSR + Vue 將節點掛到 body 時 hydration 不一致；fixed 仍相對視窗 -->
  <transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open && items.length"
      class="fixed inset-0 z-[100] flex flex-col bg-[#0a0a0c] text-zinc-100 shadow-[inset_0_0_120px_rgba(0,0,0,0.5)]"
      role="dialog"
      aria-modal="true"
      aria-label="圖片預覽"
      @click.self="close"
    >
      <!-- 頂欄：實底避免與透明疊加發灰 -->
      <div
        class="flex shrink-0 items-center justify-between gap-3 border-b border-white/15 bg-zinc-950/90 px-4 py-3 backdrop-blur-[2px]"
      >
        <span
          class="rounded-md bg-zinc-800/90 px-3 py-1 text-sm font-semibold tabular-nums text-zinc-50 ring-1 ring-white/20"
        >
          {{ index + 1 }} / {{ items.length }}
        </span>
        <button
          type="button"
          class="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl font-semibold text-zinc-900 shadow-md ring-2 ring-white/30 hover:bg-zinc-100"
          aria-label="關閉"
          @click="close"
        >
          <i class="ri-close-line text-[22px] leading-none" aria-hidden="true"></i>
        </button>
      </div>

      <div class="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-8">
        <button
          v-if="items.length > 1"
          type="button"
          class="absolute left-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/40 bg-zinc-900 text-2xl text-white shadow-lg ring-2 ring-black/40 hover:border-white/70 hover:bg-zinc-800 sm:left-4 sm:h-14 sm:w-14"
          aria-label="上一張"
          @click.stop="prev"
        >
          <i class="ri-arrow-left-s-line drop-shadow-sm" aria-hidden="true"></i>
        </button>

        <div class="flex max-h-full max-w-[min(100vw-2rem,1200px)] items-center justify-center px-10 sm:px-14">
          <img
            :key="items[index]?.src + String(index)"
            :src="items[index]?.src"
            :alt="items[index]?.alt"
            class="max-h-[min(85vh,900px)] max-w-full object-contain shadow-2xl ring-1 ring-white/10"
            @click.stop
          />
        </div>

        <button
          v-if="items.length > 1"
          type="button"
          class="absolute right-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/40 bg-zinc-900 text-2xl text-white shadow-lg ring-2 ring-black/40 hover:border-white/70 hover:bg-zinc-800 sm:right-4 sm:h-14 sm:w-14"
          aria-label="下一張"
          @click.stop="next"
        >
          <i class="ri-arrow-right-s-line drop-shadow-sm" aria-hidden="true"></i>
        </button>
      </div>

      <div class="shrink-0 pb-5 pt-1 text-center">
        <p
          class="inline-block rounded-full border border-white/20 bg-zinc-900/95 px-4 py-2 text-xs font-medium leading-relaxed text-zinc-200 shadow-lg ring-1 ring-black/30 sm:text-sm"
        >
          點擊背景關閉 · ← → 切換圖片 · Esc 關閉
        </p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.cursor-zoom-in {
  cursor: zoom-in;
}
</style>
