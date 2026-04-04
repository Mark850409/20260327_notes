import MarkdownIt from 'markdown-it';
import { blocksToHtml } from './blocksToHtml';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
});

function looksLikeHtml(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (t.startsWith('<')) return true;
  return /<\/(p|div|h[1-6]|ul|ol|blockquote|pre|figure|article)\s*>/i.test(t);
}

/**
 * Strapi body：可能是 blocks JSON、HTML 字串，或後台 Rich text 貼上的 Markdown 字串。
 */
export function blogBodyToHtml(body: unknown): string {
  if (body == null) return '';
  if (typeof body !== 'string') return blocksToHtml(body);

  const raw = body;
  if (!raw.trim()) return '';

  if (looksLikeHtml(raw)) return raw;
  return md.render(raw);
}
