<template>
  <aside
    id="site-sidebar"
    :class="[
      'sidebar flex shrink-0 flex-col overflow-hidden border-r border-zinc-700/80 bg-zinc-900/95 text-zinc-300 backdrop-blur-md transition-[width] duration-200 ease-out',
      'fixed inset-y-0 left-0 z-40 w-[min(100vw,18rem)] -translate-x-full shadow-xl [&.open]:translate-x-0',
      'md:relative md:z-10 md:h-auto md:min-h-[100dvh] md:translate-x-0 md:self-stretch md:shadow-none',
      collapsed && !isMobile ? 'md:w-14 md:min-w-[3.5rem]' : 'md:w-72 md:min-w-[18rem]',
    ]"
    aria-label="側欄"
  >
    <div v-show="showFull" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        class="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2"
      >
        <!-- 作者區（Strapi） -->
        <div v-if="profile.avatarUrl" class="mb-2 flex justify-center">
          <img
            :src="profile.avatarUrl"
            alt="Author Avatar"
            class="h-20 w-20 rounded-full border border-zinc-600 object-cover shadow-md"
            loading="lazy"
          />
        </div>
        <p class="text-center text-xs text-zinc-500">
          {{ profile.displayName || profile.authorLabel || 'Author' }}
        </p>
        <h2 class="mt-1 text-center text-3xl font-bold tracking-tight text-zinc-100">
          {{ profile.siteTitle || siteTitle }}
        </h2>
        <p v-if="profile.motto" class="mt-2 text-center text-sm text-zinc-400">
          {{ profile.motto }}
        </p>
        <blockquote
          v-if="profile.quote"
          class="mt-4 border-l-2 border-accent/60 pl-3 text-center text-sm leading-relaxed text-zinc-400"
        >
          <p class="text-left">{{ profile.quote }}</p>
          <cite v-if="profile.quoteSource" class="mt-2 block not-italic text-zinc-500">{{
            profile.quoteSource
          }}</cite>
        </blockquote>

        <!-- 統計 -->
        <div
          class="mt-5 grid grid-cols-3 gap-1 border-y border-zinc-700/80 py-3 text-center text-xs"
        >
          <div>
            <div class="text-lg font-semibold text-zinc-100">{{ stats.posts }}</div>
            <div class="text-zinc-500">文章</div>
          </div>
          <div class="border-x border-zinc-700/80">
            <div class="text-lg font-semibold text-zinc-100">{{ stats.categories }}</div>
            <div class="text-zinc-500">分類</div>
          </div>
          <div>
            <div class="text-lg font-semibold text-zinc-100">{{ stats.tags }}</div>
            <div class="text-zinc-500">標籤</div>
          </div>
        </div>

        <!-- 社群 -->
        <div v-if="profile.socialLinks?.length" class="mt-4 flex flex-wrap justify-center gap-2">
          <a
            v-for="(s, i) in profile.socialLinks"
            :key="i"
            :href="s.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-300 hover:border-accent hover:text-accent"
          >
            <span>{{ socialGlyph(s.iconKey) }}</span>
            {{ s.label }}
          </a>
        </div>

        <!-- 授權 -->
        <div v-if="profile.licenseImageUrl" class="mt-4 flex justify-center">
          <img
            :src="profile.licenseImageUrl"
            alt="License"
            class="max-h-10 opacity-90"
            loading="lazy"
          />
        </div>
        <div
          v-else-if="profile.licenseHtml"
          class="license-html mt-4 text-center text-xs text-zinc-500 [&_a]:text-accent [&_a]:underline"
          v-html="profile.licenseHtml"
        />

        <!-- 近期文章 -->
        <div class="mt-6 border-t border-zinc-700/80 pt-4">
          <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
            <span aria-hidden="true">⟲</span>
            近期文章
          </h3>
          <ul class="space-y-1.5 text-sm">
            <li v-for="a in recentArticles" :key="a.id">
              <a
                :href="`/notes/${a.slug}`"
                class="line-clamp-2 text-zinc-400 hover:text-accent"
                >{{ a.title }}</a
              >
            </li>
          </ul>
          <p v-if="!recentArticles.length" class="text-xs text-zinc-600">尚無文章</p>
        </div>

        <!-- 搜尋 -->
        <div class="mt-5">
          <input
            v-model="query"
            type="text"
            placeholder="搜尋..."
            class="w-full rounded-lg border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            @keyup.enter="goSearch"
          />
        </div>

        <!-- 分類 -->
        <div class="mt-5">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">分類</div>
          <div v-if="loading" class="text-xs text-zinc-600">載入中...</div>
          <div v-else-if="!categories.length" class="text-xs text-zinc-600">尚無分類</div>
          <ul v-else class="space-y-0.5">
            <li v-for="cat in categories" :key="cat.id">
              <button
                type="button"
                class="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm text-zinc-400 hover:bg-zinc-800"
                :class="openCats.includes(cat.slug) ? 'bg-zinc-800 text-accent' : ''"
                @click="toggleCat(cat.slug)"
              >
                <span class="w-3 shrink-0 text-xs">{{ openCats.includes(cat.slug) ? '▾' : '›' }}</span>
                <span class="min-w-0 flex-1 truncate">{{ cat.name }}</span>
              </button>
              <Transition name="slide">
                <ul
                  v-if="openCats.includes(cat.slug)"
                  class="ml-3 border-l border-zinc-700 py-1 pl-2"
                >
                  <li v-if="!catArticles[cat.slug]" class="px-2 py-0.5 text-xs text-zinc-600">
                    載入中...
                  </li>
                  <li v-else-if="!catArticles[cat.slug].length" class="px-2 py-0.5 text-xs text-zinc-600">
                    暫無文章
                  </li>
                  <li v-for="art in catArticles[cat.slug]" :key="art.id">
                    <a
                      :href="`/notes/${art.slug}`"
                      class="block truncate rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      :class="
                        isCurrentPage(art.slug)
                          ? 'border-l-2 border-accent bg-zinc-800/80 pl-1.5 font-medium text-accent'
                          : ''
                      "
                      >{{ art.title }}</a
                    >
                  </li>
                </ul>
              </Transition>
            </li>
          </ul>
        </div>

        <div class="mt-6 border-t border-zinc-700/80 pt-3">
          <a
            href="/admin"
            target="_blank"
            rel="noopener"
            class="text-xs text-zinc-500 hover:text-accent"
            >CMS 後台</a
          >
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  categories: { type: Array, default: () => [] },
  siteTitle: { type: String, default: 'My Notes' },
  profile: { type: Object, default: () => ({}) },
  recentArticles: { type: Array, default: () => [] },
  stats: {
    type: Object,
    default: () => ({ posts: 0, categories: 0, tags: 0 }),
  },
})

const COLLAPSE_KEY = 'sidebar-collapsed'

let mediaQuery = null
let syncMediaQuery = null

const profile = computed(() => props.profile || {})
const query = ref('')
const openCats = ref([])
const catArticles = ref({})
const loading = ref(false)
const collapsed = ref(false)
const isMobile = ref(true)

const apiBase = computed(() => '/api')

const showFull = computed(() => {
  if (isMobile.value) return true
  return !collapsed.value
})

function socialGlyph(key) {
  const k = (key || '').toLowerCase()
  if (k === 'github') return '⌘'
  if (k === 'mail' || k === 'email') return '✉'
  if (k === 'docker') return '◫'
  return '·'
}

function setCollapsed(v) {
  collapsed.value = v
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0')
  } catch (_) {}
}

async function toggleCat(slug) {
  const idx = openCats.value.indexOf(slug)
  if (idx > -1) {
    openCats.value.splice(idx, 1)
  } else {
    openCats.value.push(slug)
    if (!catArticles.value[slug]) {
      await loadCatArticles(slug)
    }
  }
}

async function loadCatArticles(slug) {
  try {
    const res = await fetch(`${apiBase.value}/articles?category=${slug}&limit=30`)
    if (res.ok) {
      const json = await res.json()
      catArticles.value[slug] = json.data || []
    }
  } catch {
    catArticles.value[slug] = []
  }
}

function goSearch() {
  if (query.value.trim()) {
    window.location.href = `/?q=${encodeURIComponent(query.value.trim())}`
  }
}

function isCurrentPage(slug) {
  return typeof window !== 'undefined' && window.location.pathname === `/notes/${slug}`
}

function onToggleDesktopCollapse() {
  if (!isMobile.value) setCollapsed(!collapsed.value)
}

onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 767px)')
  syncMediaQuery = () => {
    isMobile.value = mediaQuery.matches
  }
  syncMediaQuery()
  mediaQuery.addEventListener('change', syncMediaQuery)

  window.addEventListener('notes-sidebar:toggle-desktop', onToggleDesktopCollapse)

  try {
    collapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch (_) {}

  const path = window.location.pathname
  const match = path.match(/^\/notes\/(.+)$/)
  if (match && props.categories.length > 0) {
    const slug = props.categories[0].slug
    openCats.value.push(slug)
    loadCatArticles(slug)
  }
})

onUnmounted(() => {
  window.removeEventListener('notes-sidebar:toggle-desktop', onToggleDesktopCollapse)
  if (mediaQuery && syncMediaQuery) {
    mediaQuery.removeEventListener('change', syncMediaQuery)
  }
})
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
