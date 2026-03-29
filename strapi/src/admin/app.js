import React from 'react';
import { Upload } from '@strapi/icons';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { openPasteImageUploadDialog } from './utils/pasteImageModal';
import { buildTimestampPastedFileName } from './utils/pasteImageFileName';
import { initNotesSidebarHamburger } from './utils/notesSidebarHamburger';

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
      const fd = new FormData();
      fd.append('files', named, named.name || `pasted-${Date.now()}.png`);
      fd.append('fileName', dialogResult.fileName || named.name || `pasted-${Date.now()}.png`);
      fd.append('useFolder', dialogResult.useFolder ? 'true' : 'false');
      fd.append('folderName', dialogResult.folderName || '');
      const res = await fetch('/api/upload/inline-image', {
        method: 'POST',
        body: fd,
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
        const uploadedItems = [];
        for (let i = 0; i < pending.length; i += 1) {
          const { item, file } = pending[i];
          const defaultFileName = buildTimestampPastedFileName(
            file,
            item.type,
            i,
            pending.length,
            batchTs,
          );
          // eslint-disable-next-line no-await-in-loop
          const dialog = await openPasteImageUploadDialog({
            defaultFileName,
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
     * Strapi 5 官方已移除可收合主側欄（僅保留窄圖示列＋ tooltip），無對應 Admin API。
     * 改為自訂左上角漢堡鈕：見 ./utils/notesSidebarHamburger.js
     */
    initNotesSidebarHamburger();
  },
};
