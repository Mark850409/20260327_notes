<template>
  <span class="hidden" aria-hidden="true" />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import hljs from 'highlight.js/lib/common'
import githubCssUrl from 'highlight.js/styles/github.css?url'
import githubDarkCssUrl from 'highlight.js/styles/github-dark.css?url'

/** 與 ThemeToggle 一致：避免 island 早於 header 掛載時誤用淺色 hljs */
function getEffectiveDark() {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark') return true
    if (saved === 'light') return false
  } catch {
    /* ignore */
  }
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

let themeObserver = null

function setHljsStylesheet(dark) {
  let link = document.getElementById('notes-hljs-theme')
  if (!link) {
    link = document.createElement('link')
    link.id = 'notes-hljs-theme'
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  link.href = dark ? githubDarkCssUrl : githubCssUrl
}

/**
 * 後端 codehilite（Pygments）產生 .highlight + span。
 * 改為 highlight.js + 單一外框、行號欄、複製按鈕（避免 prose 邊框與 hljs 主題疊成雙框）。
 */
function extractLang(el) {
  const pre = el.querySelector('pre')
  if (!pre) return ''
  const combined = `${el.className || ''} ${pre.className || ''}`
  const m =
    combined.match(/(?:^|\s)language-([\w-]+)/i) || combined.match(/(?:^|\s)lang-([\w-]+)/i)
  return m ? m[1].toLowerCase() : ''
}

function upgradePygmentsBlocks(root) {
  root.querySelectorAll('.highlight').forEach((block) => {
    const oldPre = block.querySelector('pre')
    if (!oldPre) return
    const text = oldPre.textContent ?? ''
    const lang = extractLang(block)

    const wrap = document.createElement('div')
    wrap.className =
      'code-block-wrap not-prose my-5 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950'

    const toolbar = document.createElement('div')
    toolbar.className =
      'flex items-center justify-end border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900/80'

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className =
      'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
    copyBtn.textContent = '複製'
    copyBtn.setAttribute('aria-label', '複製程式碼到剪貼簿')
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text)
        copyBtn.textContent = '已複製'
        setTimeout(() => {
          copyBtn.textContent = '複製'
        }, 2000)
      } catch {
        copyBtn.textContent = '無法複製'
        setTimeout(() => {
          copyBtn.textContent = '複製'
        }, 2000)
      }
    })
    toolbar.appendChild(copyBtn)

    const row = document.createElement('div')
    row.className = 'flex min-w-0'

    const lineCount = Math.max(1, text.split('\n').length)
    const gutter = document.createElement('div')
    gutter.className =
      'code-line-gutter shrink-0 whitespace-pre select-none border-r border-zinc-200 bg-zinc-50 py-[1em] pl-3 pr-3 text-right font-mono text-[0.8125rem] leading-[1.5] text-zinc-500 tabular-nums dark:border-zinc-700 dark:bg-[#161b22] dark:text-zinc-400'
    gutter.setAttribute('aria-hidden', 'true')
    gutter.textContent = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n')

    const pre = document.createElement('pre')
    pre.className =
      'code-block-pre m-0 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[0.8125rem] leading-[1.5]'

    const code = document.createElement('code')
    code.textContent = text
    if (lang) code.classList.add(`language-${lang}`)

    pre.appendChild(code)
    row.appendChild(gutter)
    row.appendChild(pre)
    wrap.appendChild(toolbar)
    wrap.appendChild(row)

    block.replaceWith(wrap)

    try {
      hljs.highlightElement(code)
    } catch {
      code.removeAttribute('class')
      code.classList.add('language-plaintext')
      hljs.highlightElement(code)
    }
  })
}

onMounted(() => {
  setHljsStylesheet(getEffectiveDark())
  themeObserver = new MutationObserver(() => {
    setHljsStylesheet(getEffectiveDark())
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  const root = document.querySelector('.article-body')
  if (root) upgradePygmentsBlocks(root)
})

onUnmounted(() => {
  themeObserver?.disconnect()
  themeObserver = null
})
</script>
