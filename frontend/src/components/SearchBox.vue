<template>
  <div
    class="relative flex items-center rounded-xl border border-zinc-200 bg-white shadow-sm transition-all dark:border-zinc-700 dark:bg-zinc-900"
    :class="
      focused
        ? 'border-accent shadow-md ring-2 ring-accent/20'
        : ''
    "
  >
    <div class="pointer-events-none select-none pl-4 pr-1 text-lg text-zinc-400" aria-hidden="true">⌕</div>
    <input
      ref="inputRef"
      v-model="query"
      type="search"
      placeholder="搜尋文章、標題、內容..."
      class="min-w-0 flex-1 border-0 bg-transparent py-2.5 pr-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
      @focus="focused = true"
      @blur="onBlur"
      @input="onInput"
      @keyup.enter="goSearch"
      @keydown.escape="clear"
    />
    <button
      v-if="query"
      type="button"
      class="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      @click="clear"
    >
      ✕
    </button>

    <Transition name="dropdown">
      <div
        v-if="results.length > 0 && focused"
        class="absolute left-0 right-0 top-[calc(100%+8px)] z-[100] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
      >
        <div v-if="loading" class="px-4 py-3 text-sm text-zinc-500">搜尋中...</div>
        <a
          v-else
          v-for="item in results"
          :key="item.id"
          :href="`/notes/${item.slug}`"
          class="block border-b border-zinc-100 px-4 py-3 no-underline transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
        >
          <div class="dropdown-title text-sm font-medium text-zinc-900 dark:text-zinc-100" v-html="highlight(item.title)"></div>
          <div v-if="item.description" class="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {{ item.description }}
          </div>
          <div v-if="item.category" class="mt-1 text-[0.6875rem] font-medium text-accent">
            {{ item.category.name }}
          </div>
        </a>
        <div class="bg-zinc-50 px-4 py-2 text-center text-xs text-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-400">
          按 Enter 查看全部結果
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  apiBase: { type: String, default: '/api' },
})

const query = ref('')
const results = ref([])
const loading = ref(false)
const focused = ref(false)
const inputRef = ref(null)

let debounceTimer = null

function onInput() {
  clearTimeout(debounceTimer)
  if (!query.value.trim()) {
    results.value = []
    return
  }
  debounceTimer = setTimeout(search, 300)
}

async function search() {
  const q = query.value.trim()
  if (!q) return
  loading.value = true
  try {
    const res = await fetch(`/api/articles?q=${encodeURIComponent(q)}&limit=6`)
    if (res.ok) {
      const json = await res.json()
      results.value = json.data || []
    }
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
}

function goSearch() {
  if (query.value.trim()) {
    window.location.href = `/?q=${encodeURIComponent(query.value.trim())}`
  }
}

function clear() {
  query.value = ''
  results.value = []
  inputRef.value?.focus()
}

function onBlur() {
  setTimeout(() => {
    focused.value = false
  }, 200)
}

function highlight(text) {
  if (!query.value) return text
  const re = new RegExp(`(${query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.replace(re, '<mark>$1</mark>')
}
</script>

<style scoped>
.dropdown-title :deep(mark) {
  border-radius: 3px;
  background: rgba(73, 177, 245, 0.2);
  color: #3790d0;
  padding: 0 0.15em;
}
:global([data-theme='dark']) .dropdown-title :deep(mark) {
  background: rgba(73, 177, 245, 0.2);
  color: #7dd3fc;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 180ms ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
