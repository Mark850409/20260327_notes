type BlockNode = Record<string, any>;

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeUrl(s: any): string {
  const raw = String(s ?? '').trim();
  if (!raw) return '';
  // Allow relative (/uploads/..), http(s), mailto, tel
  if (/^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(raw)) return raw;
  return '';
}

function renderTextLeaf(leaf: BlockNode): string {
  let out = escapeHtml(leaf.text ?? '');
  if (!out) return '';

  if (leaf.code) out = `<code>${out}</code>`;
  if (leaf.bold) out = `<strong>${out}</strong>`;
  if (leaf.italic) out = `<em>${out}</em>`;
  if (leaf.underline) out = `<u>${out}</u>`;
  if (leaf.strikethrough) out = `<s>${out}</s>`;

  return out;
}

function renderInline(children: any[]): string {
  if (!Array.isArray(children)) return '';
  return children
    .map((c) => {
      if (!c || typeof c !== 'object') return escapeHtml(c);
      const type = String(c.type || '').toLowerCase();
      if (!type && 'text' in c) return renderTextLeaf(c);

      if (type === 'link') {
        const href = escapeUrl(c.url || c.href);
        const inner = renderInline(c.children || []);
        if (!href) return inner;
        return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${inner}</a>`;
      }

      return renderTextLeaf(c);
    })
    .join('');
}

function renderBlock(node: BlockNode): string {
  const type = String(node?.type || '').toLowerCase();
  const children = node?.children;

  if (type === 'paragraph') return `<p>${renderInline(children)}</p>`;

  if (type === 'heading') {
    const lvl = Math.min(6, Math.max(1, parseInt(String(node.level ?? node?.data?.level ?? '2'), 10) || 2));
    return `<h${lvl}>${renderInline(children)}</h${lvl}>`;
  }

  if (type === 'quote') return `<blockquote><p>${renderInline(children)}</p></blockquote>`;

  if (type === 'list') {
    const format = String(node.format || node?.data?.format || '').toLowerCase();
    const tag = format === 'ordered' || format === 'ol' ? 'ol' : 'ul';
    const items = Array.isArray(children) ? children.map(renderBlock).join('') : '';
    return `<${tag}>${items}</${tag}>`;
  }

  if (type === 'list-item' || type === 'listitem') return `<li>${renderInline(children)}</li>`;

  if (type === 'code') {
    const codeText = Array.isArray(children) ? children.map((c) => (c?.text != null ? String(c.text) : '')).join('') : '';
    const lang = escapeHtml(node.language || node.lang || '');
    const cls = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${cls}>${escapeHtml(codeText)}</code></pre>`;
  }

  if (type === 'image') {
    const src = escapeUrl(node.url || node.src);
    if (!src) return '';
    const alt = escapeHtml(node.alt || '');
    return `<figure><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" /></figure>`;
  }

  // Fallback: render children as paragraph-ish
  if (Array.isArray(children)) {
    const inner = children.map((c) => (typeof c === 'object' ? renderBlock(c) : escapeHtml(c))).join('');
    return inner;
  }

  return '';
}

export function blocksToHtml(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  const nodes = Array.isArray(input) ? input : Array.isArray(input?.children) ? input.children : [];
  if (!Array.isArray(nodes) || nodes.length === 0) return '';
  return nodes.map((n) => (typeof n === 'object' ? renderBlock(n) : escapeHtml(n))).join('');
}

