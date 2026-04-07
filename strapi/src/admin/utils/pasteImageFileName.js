/**
 * 貼圖上傳對話框預設檔名。
 * 預設格式：timestamp_標題_流水號.ext（可於對話框手動修改）
 */

export function extensionForPastedImage(file, clipboardMime) {
  const mime = String(file?.type || clipboardMime || '').toLowerCase();
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('jpg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('bmp')) return '.bmp';
  const n = (file?.name || '').toLowerCase();
  const m = n.match(/(\.[a-z0-9]{2,8})$/i);
  if (m) return m[1];
  return '.png';
}

/** 檔名用標題片段：保留中英數，危險字元改底線 */
export function sanitizeTitleForFile(title) {
  const t = (title || '').trim().slice(0, 120) || 'untitled';
  const cleaned = t
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'untitled';
}

/**
 * 預設檔名：timestamp_標題_流水號.ext（與批次匯入 MinIO 物件鍵風格一致）
 * @param {string} title 通常取自表單 title 欄位
 * @param {File} file
 * @param {string} [clipboardMime]
 * @param {number} indexInBatch 0-based
 * @param {number} totalInBatch
 * @param {number} [batchTimestamp] 同一次貼上事件共用
 */
export function buildTimestampTitleSerialFileName(
  title,
  file,
  clipboardMime,
  indexInBatch,
  totalInBatch,
  batchTimestamp,
) {
  void totalInBatch;
  const ext = extensionForPastedImage(file, clipboardMime);
  const ts = typeof batchTimestamp === 'number' ? batchTimestamp : Date.now();
  const serial = String(indexInBatch + 1).padStart(2, '0');
  const base = sanitizeTitleForFile(title);
  return `${ts}_${base}_${serial}${ext}`;
}

/**
 * @deprecated 請使用 buildTimestampTitleSerialFileName；保留供舊邏輯參考
 */
export function buildTimestampPastedFileName(
  file,
  clipboardMime,
  indexInBatch,
  totalInBatch,
  batchTimestamp,
) {
  return buildTimestampTitleSerialFileName(
    'untitled',
    file,
    clipboardMime,
    indexInBatch,
    totalInBatch,
    batchTimestamp,
  );
}
