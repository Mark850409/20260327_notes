<template>
  <button
    type="button"
    class="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:border-accent hover:text-accent hover:shadow-[0_0_0_2px_rgba(73,177,245,0.12)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
    :title="isDark ? '切換至淺色主題' : '切換至深色主題'"
    aria-label="Toggle theme"
    @click="toggle"
  >
    <Transition name="icon-swap" mode="out-in">
      <span v-if="isDark" key="sun" class="text-sm leading-none">☀</span>
      <span v-else key="moon" class="text-sm leading-none">☾</span>
    </Transition>
  </button>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const isDark = ref(false)

onMounted(() => {
  const saved = localStorage.getItem('theme')
  isDark.value = saved === 'dark'
  apply()
})

function toggle() {
  isDark.value = !isDark.value
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  apply()
}

function apply() {
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
}
</script>

<style scoped>
.icon-swap-enter-active,
.icon-swap-leave-active {
  transition: all 150ms ease;
}
.icon-swap-enter-from {
  opacity: 0;
  transform: rotate(-30deg) scale(0.7);
}
.icon-swap-leave-to {
  opacity: 0;
  transform: rotate(30deg) scale(0.7);
}
</style>
