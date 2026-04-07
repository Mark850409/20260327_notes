import React from 'react';
import { Upload } from '@strapi/icons';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { openPasteImageUploadDialog } from './utils/pasteImageModal';
import { buildTimestampTitleSerialFileName } from './utils/pasteImageFileName';

/**
 * 後台介面語言：Strapi 內建檔為 zh.json（繁體）、zh-Hans.json（簡體），沒有 zh-Hant。
 * 見：https://docs.strapi.io/cms/admin-panel-customization/locales-translations
 */
export default {
  register(app) {
    app.addMenuLink({
      to: '/notes-import',
      icon: Upload,
      intlLabel: {
        id: 'notes-import.label',
        defaultMessage: '批次匯入筆記',
      },
      Component: async () => {
        const mod = await import('./pages/NotesImportPage');
        return mod.default;
      },
      permissions: [],
    });
  },
  config: {
    // en 為預設／fallback，無法移除；zh 即繁體中文介面
    locales: ['zh'],
    // 補齊 zh 訊息，避免 @formatjs/intl MISSING_TRANSLATION 洗版（F12）
    translations: {
      zh: {
        'notes-import.label': '批次匯入筆記',
        'content-manager.plugin.name': '內容管理',
        // Content-Type 顯示名在 zh 缺漏時 formatjs 會以 displayName 當 key（含尾端空白）
        'Article ': '文章',
        Article: '文章',
        category: '分類',
        Category: '分類',
        'category.owner': '擁有者（API 使用者）',
        User: '使用者',
        'Site Profile': '網站設定',
        owner: '擁有者（API 使用者）',
        Owner: '擁有者（API 使用者）',
        'content-manager.containers.list.table-headers.status': '狀態',
      },
    },
  },
  bootstrap() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const isArticleContentRoute = () =>
      window.location.pathname.includes('/content-manager/collection-types/api::article.article');

    /** 從內容管理編輯表單推斷 title，供貼圖預設檔名使用 */
    const getArticleTitleFromDom = () => {
      const root = document.querySelector('#app, [role="main"], main') || document.body;
      const candidates = root.querySelectorAll(
        'input[type="text"]:not([readonly]), textarea:not([readonly])',
      );
      for (const el of candidates) {
        const name = (el.getAttribute('name') || '').toLowerCase();
        const id = (el.getAttribute('id') || '').toLowerCase();
        const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
        const ph = String(el.getAttribute('placeholder') || '').toLowerCase();
        const block = el.closest('[class*="Field"], [data-strapi-field], fieldset, div') || el.parentElement;
        const blockText = (block?.textContent || '').slice(0, 120).toLowerCase();
        if (
          name === 'title' ||
          id.includes('title') ||
          /title|標題/.test(`${aria} ${ph} ${blockText}`)
        ) {
          return (el.value || '').trim();
        }
      }
      return '';
    };

    const isEditableElement = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLInputElement && el.type === 'text') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const findEditableTarget = (start) => {
      let node = start;
      while (node && node instanceof HTMLElement) {
        if (isEditableElement(node)) return node;
        node = node.parentElement;
      }
      const active = document.activeElement;
      if (active && active instanceof HTMLElement && isEditableElement(active)) return active;
      return null;
    };

    const insertTextToTarget = (target, text) => {
      if (!target) return false;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        const before = target.value.slice(0, start);
        const after = target.value.slice(end);
        target.value = `${before}${text}${after}`;
        const caret = start + text.length;
        target.setSelectionRange(caret, caret);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }

      if (target instanceof HTMLElement && target.isContentEditable) {
        try {
          const ok = document.execCommand('insertText', false, text);
          if (ok) {
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        } catch {
          // fallback below
        }
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return false;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      return false;
    };

    const escapeHtmlAttr = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');

    const toAbsoluteUploadUrl = (url) => {
      try {
        return new URL(url, window.location.origin).href;
      } catch {
        return url;
      }
    };

    /**
     * Strapi 5 richtext（Blocks / Lexical）多半不會把 execCommand('insertText') 同步進 React state；
     * 改送合成 paste（text/html 含 img），讓編輯器走內建貼上解析。
     */
    const trySyntheticPasteImageBlocks = (element, plain, html) => {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', plain);
        dt.setData('text/html', html);
        const ev = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        element.dispatchEvent(ev);
        // Lexical 等編輯器成功處理貼上時會 preventDefault，此時 dispatchEvent 回傳 false；
        // 以 defaultPrevented 判斷是否已由編輯器接手，避免再 execCommand 重複插入。
        return ev.defaultPrevented === true;
      } catch {
        return false;
      }
    };

    const insertRichTextInlineImages = (target, items) => {
      if (!target || !items?.length) return false;
      const plain = items.map(({ name, url }) => `![${name}](${url})`).join('\n');
      const html = items
        .map(({ name, url }) => {
          const src = escapeHtmlAttr(toAbsoluteUploadUrl(url));
          const alt = escapeHtmlAttr(name || 'image');
          return `<p><img src="${src}" alt="${alt}" /></p>`;
        })
        .join('');
      if (target instanceof HTMLElement && target.isContentEditable) {
        if (trySyntheticPasteImageBlocks(target, plain, html)) return true;
        try {
          const abs = toAbsoluteUploadUrl(items[0].url);
          if (document.execCommand('insertHTML', false, html)) {
            target.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
          if (document.execCommand('insertImage', false, abs)) {
            target.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        } catch {
          // fall through
        }
      }
      return insertTextToTarget(target, `\n${plain}\n`);
    };

    const cloneRangeIfInside = (range, ancestor) => {
      if (!range || !ancestor || !(ancestor instanceof Node)) return null;
      try {
        if (!ancestor.contains(range.commonAncestorContainer)) return null;
        return range.cloneRange();
      } catch {
        return null;
      }
    };

    const restoreSelectionRange = (range) => {
      if (!range) return;
      try {
        const sel = window.getSelection();
        if (!sel) return;
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        // DOM 可能已更新，略過
      }
    };

    const uploadClipboardImage = async (file, clipboardItemType, dialogResult) => {
      const type = (file.type || clipboardItemType || '').trim();
      const safeType = type.startsWith('image/') ? type : 'image/png';
      const blob = file;
      const named =
        file.type === safeType && file instanceof File
          ? file
          : new File([blob], file.name || `pasted-${Date.now()}.png`, { type: safeType });
      const mode = dialogResult?.mode === 'minio' ? 'minio' : 'media';

      if (mode === 'minio') {
        const fd = new FormData();
        fd.append('files', named, named.name || `pasted-${Date.now()}.png`);
        fd.append('fileName', dialogResult.fileName || named.name || `pasted-${Date.now()}.png`);
        fd.append('objectPathPrefix', dialogResult.minioPathPrefix || '');
        const res = await fetch('/api/upload/paste-minio', {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = json?.error?.message || json?.error || json?.message || '';
          throw new Error(msg || `MinIO 上傳失敗 (${res.status})`);
        }
        if (!json?.url) throw new Error('MinIO 上傳成功但未取得 URL');
        return {
          url: json.url,
          name: json.name || file.name || 'image',
        };
      }

      const fd = new FormData();
      fd.append('files', named, named.name || `pasted-${Date.now()}.png`);
      fd.append('fileName', dialogResult.fileName || named.name || `pasted-${Date.now()}.png`);
      fd.append('useFolder', dialogResult.useFolder ? 'true' : 'false');
      fd.append('folderName', dialogResult.folderName || '');
      const res = await fetch('/api/upload/inline-image', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.error?.message || json?.error || '';
        throw new Error(msg || `圖片上傳失敗 (${res.status})`);
      }
      if (!json?.url) throw new Error('圖片上傳成功但未取得 URL');
      return {
        url: json.url,
        name: json.name || file.name || 'image',
      };
    };

    const onPaste = async (event) => {
      if (!isArticleContentRoute()) return;
      if (!event.isTrusted) return;

      const dt = event.clipboardData;
      if (!dt?.items?.length) return;
      const imageItems = Array.from(dt.items).filter(
        (i) => i.kind === 'file' && (!i.type || i.type.startsWith('image/')),
      );
      if (!imageItems.length) return;

      const target = findEditableTarget(event.target);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();

      let savedRange = null;
      let savedInputCaret = null;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        savedInputCaret = {
          start: target.selectionStart ?? target.value.length,
          end: target.selectionEnd ?? target.value.length,
        };
      } else {
        try {
          const sel = window.getSelection();
          if (sel?.rangeCount) {
            savedRange = cloneRangeIfInside(sel.getRangeAt(0), target);
          }
        } catch {
          savedRange = null;
        }
      }

      try {
        const pending = [];
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (file) pending.push({ item, file });
        }
        if (!pending.length) return;

        const batchTs = Date.now();
        const docTitle = getArticleTitleFromDom() || 'untitled';
        const uploadedItems = [];
        for (let i = 0; i < pending.length; i += 1) {
          const { item, file } = pending[i];
          const defaultFileName = buildTimestampTitleSerialFileName(
            docTitle,
            file,
            item.type,
            i,
            pending.length,
            batchTs,
          );
          // eslint-disable-next-line no-await-in-loop
          const dialog = await openPasteImageUploadDialog({
            defaultFileName,
            defaultMinioPathPrefix: '',
            index: i + 1,
            total: pending.length,
          });
          if (!dialog) continue;
          // eslint-disable-next-line no-await-in-loop
          const uploaded = await uploadClipboardImage(file, item.type, dialog);
          uploadedItems.push({ url: uploaded.url, name: uploaded.name });
        }
        if (!uploadedItems.length) return;

        const pickVisibleContentEditable = () => {
          const nodes = [...document.querySelectorAll('[contenteditable="true"]')];
          const scored = nodes
            .map((el) => ({ el, h: el.getBoundingClientRect().height }))
            .filter(({ h }) => h > 48);
          return scored.length ? scored[scored.length - 1].el : null;
        };

        const editable =
          target instanceof HTMLElement && document.contains(target)
            ? target
            : findEditableTarget(document.activeElement) || pickVisibleContentEditable();
        if (!editable) return;

        editable.focus();
        if (savedInputCaret && editable instanceof HTMLTextAreaElement) {
          const max = editable.value.length;
          const a = Math.min(savedInputCaret.start, max);
          const b = Math.min(savedInputCaret.end, max);
          editable.setSelectionRange(a, b);
        } else if (savedInputCaret && editable instanceof HTMLInputElement) {
          const max = editable.value.length;
          const a = Math.min(savedInputCaret.start, max);
          const b = Math.min(savedInputCaret.end, max);
          editable.setSelectionRange(a, b);
        } else {
          restoreSelectionRange(savedRange);
        }

        const runInsert = () => {
          insertRichTextInlineImages(editable, uploadedItems);
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(runInsert);
        });
      } catch (error) {
        void Swal.fire({
          icon: 'error',
          title: '貼上圖片上傳失敗',
          text: error?.message || 'unknown error',
          confirmButtonText: '確定',
        });
      }
    };

    document.addEventListener('paste', onPaste, true);

    /**
     * Content Manager 列表／編輯頁的多選關聯（tags、articles）在 zh 介面常顯示「N 項」或只顯示「項」。
     * React 常把「數字」與「項」拆成相鄰文字節點，需一併處理。
     */
    const patchRelationCountSuffix = () => {
      try {
        const pathName = window.location.pathname || '';
        if (!pathName.includes('/content-manager/collection-types/')) return;
        if (!pathName.includes('/api::')) return;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.includes('項')) return NodeFilter.FILTER_REJECT;
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            if (p.closest('textarea, input, [contenteditable="true"]')) {
              return NodeFilter.FILTER_REJECT;
            }
            if (p.closest('script, style')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });

        let n;
        while ((n = walker.nextNode())) {
          const raw = n.nodeValue;
          if (!raw) continue;

          let next = raw;
          if (/項/.test(raw)) {
            // 勿匹配「項目」：僅「N 項」數量摘要（項後不可接「目」）
            next = raw
              .replace(/(\d+)\s*項(?!目)/g, '$1')
              .replace(/(\d+)項(?!目)/g, '$1');
          }

          const t = raw.trim();
          if (t === '項') {
            const prev = n.previousSibling;
            if (
              prev &&
              prev.nodeType === Node.TEXT_NODE &&
              /^\d+\s*$/.test(String(prev.nodeValue || ''))
            ) {
              prev.nodeValue = String(prev.nodeValue).trim();
              next = '';
            } else if (n.previousElementSibling) {
              const pe = n.previousElementSibling;
              const pt = (pe.textContent || '').trim();
              if (/^\d+$/.test(pt)) {
                next = '';
              } else {
                next = '多選';
              }
            } else {
              next = '多選';
            }
          }

          if (next !== raw) {
            n.nodeValue = next;
          }
        }
      } catch {
        /* ignore */
      }
    };

    let patchTimer = 0;
    const schedulePatch = () => {
      if (patchTimer) window.clearTimeout(patchTimer);
      patchTimer = window.setTimeout(() => {
        patchTimer = 0;
        patchRelationCountSuffix();
      }, 0);
    };

    const mo = new MutationObserver(() => {
      schedulePatch();
    });
    try {
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    } catch {
      /* ignore */
    }
    window.addEventListener('popstate', patchRelationCountSuffix);
    patchRelationCountSuffix();

  },
};
