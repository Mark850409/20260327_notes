/**
 * Strapi 5 官方刻意移除「可展開／收合」的左側主導覽（見 GitHub strapi#22526）。
 * 此為專案自訂 DOM 輔助：以 data 標記導覽殼，避免收合後寬度為 0 時 elementsFromPoint 找不到而無法再展開。
 */

const STORAGE_KEY = 'notes-strapi-leftnav-collapsed';
const SHELL_ATTR = 'data-notes-strapi-nav-shell';

/** 高於左側導覽，低於貼圖 Modal（2147483646+） */
const Z_BTN = 9200000;
const BTN_TOP = '12px';
const BTN_LEFT_EXPANDED = '100px';
const BTN_LEFT_COLLAPSED = '12px';

function readCollapsed() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(v) {
  try {
    if (v) window.sessionStorage.setItem(STORAGE_KEY, '1');
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 從視窗左緣掃描，在祖先鏈中取較寬者（圖示列＋次選單外殼）。
 */
export function findLeftNavigationShell() {
  const vh = window.innerHeight || 800;
  const y = Math.max(160, Math.min(vh * 0.42, vh - 120));

  let best = null;
  let bestWidth = 0;

  const considerAncestors = (startEl) => {
    if (!(startEl instanceof HTMLElement)) return;
    let node = startEl;
    for (let depth = 0; depth < 16 && node; depth += 1) {
      if (node === document.body || node === document.documentElement) break;
      const st = window.getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden') {
        node = node.parentElement;
        continue;
      }
      const r = node.getBoundingClientRect();
      if (r.left > 18) {
        node = node.parentElement;
        continue;
      }
      if (r.width < 40 || r.width > 360) {
        node = node.parentElement;
        continue;
      }
      if (r.height < vh * 0.26) {
        node = node.parentElement;
        continue;
      }
      if (r.width >= bestWidth) {
        best = node;
        bestWidth = r.width;
      }
      node = node.parentElement;
    }
  };

  for (const x of [4, 10, 20, 32, 48, 72]) {
    let stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch {
      return best;
    }
    if (!stack?.length) continue;

    for (const topEl of stack) {
      considerAncestors(topEl);
    }
  }

  return best;
}

function markShell(el) {
  if (!el) return;
  document.querySelectorAll(`[${SHELL_ATTR}="1"]`).forEach((n) => {
    if (n !== el) n.removeAttribute(SHELL_ATTR);
  });
  el.setAttribute(SHELL_ATTR, '1');
}

/**
 * 優先用已標記節點（收合後寬度為 0 時仍可取回），否則重新偵測。
 */
function resolveShell(fallback) {
  const tagged = document.querySelector(`[${SHELL_ATTR}="1"]`);
  if (tagged && document.body.contains(tagged)) {
    return tagged;
  }
  if (fallback && document.body.contains(fallback)) {
    markShell(fallback);
    return fallback;
  }
  const found = findLeftNavigationShell();
  if (found) {
    markShell(found);
    return found;
  }
  return null;
}

function setCollapsedStyles(el, collapsed) {
  if (!el) return;
  if (collapsed) {
    el.dataset.notesNavCollapsed = '1';
    el.style.setProperty('width', '0', 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('max-width', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('padding', '0', 'important');
    el.style.setProperty('border', 'none', 'important');
  } else {
    delete el.dataset.notesNavCollapsed;
    [
      'width',
      'min-width',
      'max-width',
      'overflow',
      'opacity',
      'pointer-events',
      'margin',
      'padding',
      'border',
    ].forEach((p) => el.style.removeProperty(p));
  }
}

function syncHamburgerPosition(btn, collapsed) {
  btn.style.left = collapsed ? BTN_LEFT_COLLAPSED : BTN_LEFT_EXPANDED;
}

function hamburgerSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z');
  svg.appendChild(path);
  return svg;
}

/**
 * 漢堡鈕：收合時靠左（12px），展開時在圖示列右側（100px）；Alt+Shift+B。
 */
export function initNotesSidebarHamburger() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.getElementById('notes-strapi-nav-hamburger')) return;

  let collapsed = readCollapsed();
  let cachedShell = null;

  const btn = document.createElement('button');
  btn.id = 'notes-strapi-nav-hamburger';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn.setAttribute('aria-label', collapsed ? '展開左側選單' : '收合左側選單');
  btn.title = `${collapsed ? '展開' : '收合'}左側選單（Alt+Shift+B）`;
  btn.style.cssText = [
    `position:fixed;top:${BTN_TOP};left:${collapsed ? BTN_LEFT_COLLAPSED : BTN_LEFT_EXPANDED};z-index:${Z_BTN}`,
    'display:inline-flex;align-items:center;justify-content:center;',
    'width:40px;height:40px;padding:0;border-radius:8px;',
    'border:1px solid #dcdce4;background:#fff;color:#212134;',
    'cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.12);',
    'font:inherit;pointer-events:auto;isolation:isolate;',
  ].join('');
  btn.appendChild(hamburgerSvg());

  const apply = () => {
    cachedShell = resolveShell(cachedShell);
    if (!cachedShell) return;
    setCollapsedStyles(cachedShell, collapsed);
    syncHamburgerPosition(btn, collapsed);
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-label', collapsed ? '展開左側選單' : '收合左側選單');
    btn.title = `${collapsed ? '展開' : '收合'}左側選單（Alt+Shift+B）`;
    writeCollapsed(collapsed);
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    collapsed = !collapsed;
    apply();
  });

  const onKey = (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      collapsed = !collapsed;
      apply();
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(btn);

  const tryInitialApply = () => {
    cachedShell = resolveShell(cachedShell);
    if (collapsed && cachedShell) apply();
    else if (!collapsed) {
      syncHamburgerPosition(btn, false);
    }
  };
  requestAnimationFrame(tryInitialApply);
  setTimeout(tryInitialApply, 120);
  setTimeout(tryInitialApply, 600);

  const obs = new MutationObserver(() => {
    if (!collapsed) return;
    const tagged = document.querySelector(`[${SHELL_ATTR}="1"]`);
    if (tagged && document.body.contains(tagged)) return;
    cachedShell = resolveShell(null);
    if (cachedShell) setCollapsedStyles(cachedShell, true);
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
