import React from 'react';
import { Upload } from '@strapi/icons';

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

    const uploadClipboardImage = async (file) => {
      const fd = new FormData();
      fd.append('files', file, file.name || `pasted-${Date.now()}.png`);
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
      const dt = event.clipboardData;
      if (!dt?.items?.length) return;
      const imageItems = Array.from(dt.items).filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (!imageItems.length) return;

      const target = findEditableTarget(event.target);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        const lines = [];
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (!file) continue;
          // eslint-disable-next-line no-await-in-loop
          const uploaded = await uploadClipboardImage(file);
          lines.push(`![${uploaded.name}](${uploaded.url})`);
        }
        if (!lines.length) return;
        insertTextToTarget(target, `\n${lines.join('\n')}\n`);
      } catch (error) {
        // 保持可用性：失敗時不阻斷使用者，僅提示
        // eslint-disable-next-line no-alert
        window.alert(`貼上圖片上傳失敗：${error.message || 'unknown error'}`);
      }
    };

    document.addEventListener('paste', onPaste, true);
  },
};
