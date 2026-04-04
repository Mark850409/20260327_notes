<template>
  <aside
    id="site-sidebar"
    class="sidebar order-2 w-full shrink-0 px-4 pb-10 md:order-1 md:w-[18.5rem] md:min-w-[18.5rem] md:px-0 md:pt-8"
    aria-label="側欄"
  >
    <div class="flex flex-col gap-4">
      <section :class="[cardClass, 'p-5']">
        <div v-if="profile.avatarUrl" class="mb-2 flex justify-center">
          <img
            :src="profile.avatarUrl"
            alt="Author Avatar"
            class="h-20 w-20 rounded-full border border-zinc-200 object-cover shadow-sm dark:border-zinc-700"
            loading="lazy"
          />
        </div>
        <p class="text-center text-xs text-zinc-500 dark:text-zinc-400">{{ profile.displayName || profile.authorLabel || 'Author' }}</p>
        <h2 class="mt-1 text-center text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {{ profile.siteTitle || siteTitle }}
        </h2>
        <p v-if="profile.motto" class="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">{{ profile.motto }}</p>
        <blockquote
          v-if="profile.quote"
          class="mt-4 border-l-2 border-accent/60 pl-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
        >
          <p>{{ profile.quote }}</p>
          <cite v-if="profile.quoteSource" class="mt-2 block not-italic text-zinc-500 dark:text-zinc-400">{{ profile.quoteSource }}</cite>
        </blockquote>
        <div class="mt-5 grid grid-cols-3 gap-1 border-y border-zinc-200 py-3 text-center text-xs dark:border-zinc-700">
          <div>
            <div class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{{ stats.posts }}</div>
            <div class="text-zinc-500 dark:text-zinc-400">文章</div>
          </div>
          <div class="border-x border-zinc-200 dark:border-zinc-700">
            <div class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{{ stats.categories }}</div>
            <div class="text-zinc-500 dark:text-zinc-400">分類</div>
          </div>
          <div>
            <div class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{{ stats.tags }}</div>
            <div class="text-zinc-500 dark:text-zinc-400">標籤</div>
          </div>
        </div>
        <div v-if="profile.socialLinks?.length" class="mt-4 flex flex-wrap justify-center gap-2">
          <a
            v-for="(s, i) in profile.socialLinks"
            :key="i"
            :href="s.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-300"
          >
            <span>{{ socialGlyph(s.iconKey) }}</span>
            {{ s.label }}
          </a>
        </div>
        <div v-if="profile.licenseImageUrl" class="mt-4 flex justify-center">
          <img :src="profile.licenseImageUrl" alt="License" class="max-h-10 opacity-90" loading="lazy" />
        </div>
        <div
          v-else-if="profile.licenseHtml"
          class="license-html mt-4 text-center text-xs text-zinc-500 [&_a]:text-accent [&_a]:underline"
          v-html="profile.licenseHtml"
        />
      </section>

      <section :class="[cardClass, 'p-5']">
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          <span aria-hidden="true">⟲</span>
          近期技術筆記
        </h3>
        <ul class="space-y-1.5 text-sm">
          <li v-for="a in recentArticles" :key="a.id">
            <a :href="`/notes/${a.slug}`" class="line-clamp-2 text-zinc-600 hover:text-accent dark:text-zinc-300">{{ a.title }}</a>
          </li>
        </ul>
        <p v-if="!recentArticles.length" class="text-xs text-zinc-500">尚無文章</p>
      </section>

      <section id="sidebar-search" :class="[cardClass, 'scroll-mt-24 p-5']">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">搜尋</div>
        <input
          v-model="query"
          type="text"
          placeholder="搜尋..."
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-200 dark:placeholder-zinc-500"
          @keyup.enter="goSearch"
        />
      </section>

      <template v-for="key in orderedWidgetKeys" :key="key">
        <section v-if="key === 'archive' && isEnabled('archive')" :class="[cardClass, 'p-5']">
          <h3 :class="widgetTitleClass">{{ widgetTitle('archive', '歸檔') }}</h3>
          <ul class="space-y-1.5 text-sm">
            <li v-for="a in archiveItems" :key="a.period" class="flex items-center justify-between gap-3">
              <span class="text-zinc-700 dark:text-zinc-200">{{ a.label }}</span>
              <span class="tabular-nums text-zinc-500 dark:text-zinc-400">{{ a.count }}</span>
            </li>
          </ul>
          <p v-if="!archiveItems.length" class="text-xs text-zinc-500">尚無資料</p>
        </section>

        <section v-if="key === 'siteStats' && isEnabled('siteStats')" :class="[cardClass, 'p-5']">
          <h3 :class="widgetTitleClass">{{ widgetTitle('siteStats', '網站資訊') }}</h3>
          <ul class="space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
            <li class="flex justify-between gap-3">
              <span>文章數目</span><span class="tabular-nums text-zinc-600 dark:text-zinc-300">{{ siteStats.posts ?? '-' }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span>已運行時間</span><span class="tabular-nums text-zinc-600 dark:text-zinc-300">{{ siteStats.runningDays ?? '-' }} 天</span>
            </li>
            <li class="flex justify-between gap-3">
              <span>訪客數</span><span class="tabular-nums text-zinc-600 dark:text-zinc-300">{{ siteStats.visitors ?? '-' }}</span>
            </li>
            <li class="flex justify-between gap-3">
              <span>總訪問量</span><span class="tabular-nums text-zinc-600 dark:text-zinc-300">{{ siteStats.pageviews ?? '-' }}</span>
            </li>
          </ul>
        </section>

        <section v-if="key === 'tagCloud' && isEnabled('tagCloud')" :class="[cardClass, 'p-5']">
          <h3 :class="widgetTitleClass">{{ widgetTitle('tagCloud', '標籤') }}</h3>
          <div class="flex flex-wrap gap-2">
            <a
              v-for="t in tagCloudItems"
              :key="t.slug || t.name"
              :href="tagHref(t)"
              class="rounded-full bg-rose-400/90 px-3 py-1 text-xs text-white hover:bg-rose-500"
            >
              {{ t.name }}
            </a>
          </div>
          <p v-if="!tagCloudItems.length" class="text-xs text-zinc-500">尚無標籤</p>
        </section>

        <section
          v-if="key === 'categoryTree' && isEnabled('categoryTree')"
          id="sidebar-categories"
          :class="[cardClass, 'scroll-mt-24 p-5']"
        >
          <h3 :class="widgetTitleClass">{{ widgetTitle('categoryTree', '分類') }}</h3>
          <ul class="space-y-1 text-sm">
            <li v-for="row in categoryRows" :key="`${row.id}-${row.depth}`" class="flex items-center justify-between gap-2">
              <a
                :href="`/categories/${row.slug}`"
                class="truncate text-zinc-700 hover:text-accent dark:text-zinc-200"
                :style="{ paddingLeft: `${row.depth * 14}px` }"
              >
                {{ row.depth > 0 ? '└ ' : '' }}{{ row.name }}
              </a>
              <span class="tabular-nums text-zinc-500 dark:text-zinc-400">{{ row.count }}</span>
            </li>
          </ul>
          <p v-if="!categoryRows.length" class="text-xs text-zinc-500">尚無分類</p>
        </section>

        <section v-if="key === 'postCalendar' && isEnabled('postCalendar')" :class="[cardClass, 'p-5']">
          <h3 :class="widgetTitleClass">{{ widgetTitle('postCalendar', '文章日曆') }}</h3>
          <div class="mb-2 text-sm text-zinc-600 dark:text-zinc-300">
            {{ calendarData.year }} 年 {{ calendarData.month }} 月
          </div>
          <div class="grid grid-cols-7 gap-1 text-center text-xs">
            <span v-for="w in weekdayHeaders" :key="w" class="py-1 text-zinc-500">{{ w }}</span>
            <span
              v-for="cell in calendarCells"
              :key="cell.key"
              class="rounded py-1"
              :class="[
                cell.current ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400',
                cell.count > 0 ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' : '',
              ]"
            >
              {{ cell.day }}
            </span>
          </div>
        </section>

        <section v-if="key === 'clockWeather' && isEnabled('clockWeather')" :class="[cardClass, 'p-5']">
          <h3 :class="widgetTitleClass">{{ widgetTitle('clockWeather', '時鐘與天氣') }}</h3>
          <div class="text-xs text-zinc-500">{{ localDateText }}</div>
          <div class="mt-1 text-3xl font-semibold tracking-wide text-zinc-900 dark:text-zinc-100">{{ localTimeText }}</div>
          <div class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span v-if="weather.city">{{ weather.city }} · </span>
            <span v-if="weather.temperature != null">{{ weather.temperature }}{{ weather.temperatureUnit }}</span>
            <span v-if="weather.windSpeed != null"> · 風速 {{ weather.windSpeed }}</span>
            <span v-if="weather.temperature == null && weather.windSpeed == null">尚無天氣資料</span>
          </div>
        </section>
      </template>

      <section :class="[cardClass, 'p-5']">
        <a href="/admin" target="_blank" rel="noopener" class="text-xs text-zinc-500 hover:text-accent dark:text-zinc-400">CMS 後台</a>
      </section>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

/** 與 tailwind.config `darkMode: ['selector', '[data-theme="dark"]']` 對齊，避免自訂 CSS 覆蓋順序導致暗色下仍為白底 */
const cardClass =
  'rounded-[0.9rem] border border-zinc-200 bg-white/[0.92] shadow-sm dark:border-zinc-600 dark:bg-zinc-900/90'
const widgetTitleClass =
  'mb-2 flex items-center gap-[0.35rem] text-[1.45rem] font-bold leading-tight text-zinc-900 dark:text-zinc-100'

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

const profile = computed(() => props.profile || {})
const query = ref('')
const apiBase = computed(() => '/api')
const widgetConfig = computed(() => profile.value.widgetConfig || {})
const defaultOrder = ['archive', 'siteStats', 'tagCloud', 'categoryTree', 'postCalendar', 'clockWeather']
const orderedWidgetKeys = computed(() => {
  const fromConfig = Array.isArray(widgetConfig.value.order) ? widgetConfig.value.order : []
  const clean = fromConfig.filter((x) => defaultOrder.includes(x))
  return clean.length ? clean : defaultOrder
})

const archiveItems = ref([])
const siteStats = ref({})
const tagCloudItems = ref([])
const categoryTree = ref([])
const calendarData = ref({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, days: [] })
const weather = ref({})
const now = ref(new Date())
let clockTimer = null

const weekdayHeaders = computed(() => {
  const mondayFirst = widgetConfig.value.calendarStartWeekOn === 'monday'
  return mondayFirst ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六']
})

const localDateText = computed(() =>
  now.value.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
)
const localTimeText = computed(() => now.value.toLocaleTimeString('zh-TW', { hour12: false }))

const categoryRows = computed(() => {
  const rows = []
  const walk = (nodes, depth = 0) => {
    nodes.forEach((n) => {
      rows.push({ id: n.id, name: n.name, slug: n.slug, count: n.count ?? 0, depth })
      if (Array.isArray(n.children) && n.children.length) walk(n.children, depth + 1)
    })
  }
  walk(categoryTree.value || [])
  return rows
})

const calendarCells = computed(() => {
  const y = Number(calendarData.value.year || now.value.getFullYear())
  const m = Number(calendarData.value.month || now.value.getMonth() + 1)
  const first = new Date(y, m - 1, 1)
  const total = new Date(y, m, 0).getDate()
  const mondayFirst = widgetConfig.value.calendarStartWeekOn === 'monday'
  const firstWeekday = mondayFirst ? (first.getDay() + 6) % 7 : first.getDay()
  const dayMap = {}
  ;(calendarData.value.days || []).forEach((d) => {
    dayMap[d.day] = d.count
  })
  const cells = []
  const outsideDays = widgetConfig.value.calendarShowOutsideDays !== false
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({ key: `pre-${i}`, day: outsideDays ? '' : '', count: 0, current: false })
  }
  for (let day = 1; day <= total; day += 1) {
    cells.push({ key: `cur-${day}`, day, count: dayMap[day] || 0, current: true })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `post-${cells.length}`, day: outsideDays ? '' : '', count: 0, current: false })
  }
  return cells
})

function isEnabled(key) {
  const enabled = widgetConfig.value.enabled || {}
  return enabled[key] !== false
}

function widgetTitle(key, fallback) {
  const titles = widgetConfig.value.titles || {}
  return titles[key] || fallback
}

function tagHref(tagItem) {
  const slug = encodeURIComponent(tagItem?.slug || tagItem?.name || '')
  if (!slug) return '/'
  if (tagItem?.kind === 'category') return `/categories/${slug}`
  return `/?tag=${slug}`
}

function socialGlyph(key) {
  const k = (key || '').toLowerCase()
  if (k === 'github') return '⌘'
  if (k === 'mail' || k === 'email') return '✉'
  if (k === 'docker') return '◫'
  return '·'
}

function goSearch() {
  if (query.value.trim()) {
    window.location.href = `/?q=${encodeURIComponent(query.value.trim())}`
  }
}

async function fetchWidget(path) {
  const res = await fetch(`${apiBase.value}${path}`, { credentials: 'include' })
  if (!res.ok) return null
  const json = await res.json()
  return json?.data ?? null
}

async function loadWidgets() {
  try {
    const [archive, statsRes, cloud, tree, cal, weatherRes] = await Promise.all([
      isEnabled('archive')
        ? fetchWidget(`/widgets/archive?limit=${encodeURIComponent(widgetConfig.value.archiveLimit || 12)}`)
        : Promise.resolve([]),
      isEnabled('siteStats') ? fetchWidget('/widgets/site-stats') : Promise.resolve({}),
      isEnabled('tagCloud')
        ? fetchWidget(`/widgets/tag-cloud?limit=${encodeURIComponent(widgetConfig.value.tagCloudLimit || 30)}`)
        : Promise.resolve([]),
      isEnabled('categoryTree')
        ? fetchWidget(`/widgets/category-tree?depth=${encodeURIComponent(widgetConfig.value.categoryTreeDepth || 4)}`)
        : Promise.resolve([]),
      isEnabled('postCalendar') ? fetchWidget('/widgets/post-calendar') : Promise.resolve(calendarData.value),
      isEnabled('clockWeather') ? fetchWidget('/widgets/weather') : Promise.resolve({}),
    ])
    archiveItems.value = Array.isArray(archive) ? archive : []
    siteStats.value = statsRes || {}
    tagCloudItems.value = Array.isArray(cloud) ? cloud : []
    categoryTree.value = Array.isArray(tree) ? tree : []
    if (cal && typeof cal === 'object') calendarData.value = cal
    weather.value = weatherRes || {}
  } catch {
    archiveItems.value = []
    siteStats.value = {}
    tagCloudItems.value = []
    categoryTree.value = []
  }
}

onMounted(() => {
  loadWidgets()
  clockTimer = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer)
})
</script>

<style>
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
