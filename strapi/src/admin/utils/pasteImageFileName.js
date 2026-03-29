/**
 * 貼圖上傳對話框預設檔名：以時間戳為主，同次貼上多檔時加流水號後綴避免碰撞。
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

/**
 * @param {File} file
 * @param {string} [clipboardMime]
 * @param {number} indexInBatch 0-based
 * @param {number} totalInBatch
 * @param {number} [batchTimestamp] 同一次貼上事件共用同一個 Date.now()
 */
export function buildTimestampPastedFileName(
  file,
  clipboardMime,
  indexInBatch,
  totalInBatch,
  batchTimestamp,
) {
  const ext = extensionForPastedImage(file, clipboardMime);
  const ts = typeof batchTimestamp === 'number' ? batchTimestamp : Date.now();
  if (totalInBatch <= 1) {
    return `${ts}${ext}`;
  }
  const serial = String(indexInBatch + 1).padStart(2, '0');
  return `${ts}-${serial}${ext}`;
}
