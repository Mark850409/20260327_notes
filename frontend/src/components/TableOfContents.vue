<template>
  <div
    v-if="headings.length > 0"
    class="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
  >
    <div
      class="mb-3 border-b border-zinc-200 pb-3 text-xs font-bold uppercase tracking-wider text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
    >
      本文目錄
    </div>
    <nav>
      <ul class="list-none space-y-0.5">
        <li
          v-for="h in headings"
          :key="h.id"
          :class="[
            h.level === 3 ? 'pl-3' : '',
            h.level === 4 ? 'pl-6' : '',
          ]"
        >
          <a
            :href="`#${h.id}`"
            class="block max-w-full truncate rounded-r-md py-1 pl-2 text-[0.8125rem] text-zinc-500 no-underline transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            :class="
              activeId === h.id
                ? 'border-l-[3px] border-accent bg-accent/10 font-semibold text-accent'
                : 'border-l-[3px] border-transparent'
            "
            @click.prevent="scrollTo(h.id)"
          >
            {{ h.text }}
          </a>
        </li>
      </ul>
    </nav>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  htmlContent: { type: String, default: '' },
})

const headings = ref([])
const activeId = ref('')

onMounted(() => {
  parseHeadings()
  setupObserver()
})

function parseHeadings() {
  const div = document.createElement('div')
  div.innerHTML = props.htmlContent
  const els = div.querySelectorAll('h2, h3, h4')
  headings.value = Array.from(els).map((el) => ({
    id: el.id || el.textContent.trim().toLowerCase().replace(/\s+/g, '-'),
    text: el.textContent.trim(),
    level: parseInt(el.tagName[1]),
  }))
}

let observer = null
function setupObserver() {
  if (!('IntersectionObserver' in window)) return
  const els = document.querySelectorAll('h2, h3, h4')
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) activeId.value = e.target.id
      }
    },
    { rootMargin: '-10% 0% -60% 0%', threshold: 0 }
  )
  els.forEach((el) => observer.observe(el))
}

onUnmounted(() => observer?.disconnect())

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>
