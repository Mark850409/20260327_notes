import React, { useMemo, useRef, useState } from 'react';

function toReadableSize(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NotesImportPage() {
  const filesInputRef = useRef(null);
  const dirInputRef = useRef(null);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const totalSize = useMemo(() => items.reduce((s, i) => s + (i.file?.size || 0), 0), [items]);

  function normalizeFileList(fileList) {
    return Array.from(fileList || [])
      .filter((f) => f?.name?.toLowerCase()?.endsWith('.md'))
      .map((f) => ({
        file: f,
        path: f.webkitRelativePath || f.name,
      }));
  }

  function addFiles(fileList) {
    const incoming = normalizeFileList(fileList);
    setItems((prev) => {
      const map = new Map(prev.map((p) => [p.path, p]));
      for (const x of incoming) map.set(x.path, x);
      return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
    });
  }

  async function onImport() {
    if (!items.length || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const fd = new FormData();
      const paths = items.map((x) => x.path);
      for (const x of items) {
        fd.append('files', x.file, x.file.name);
      }
      fd.append('relativePaths', JSON.stringify(paths));

      const res = await fetch('/api/articles/import-markdown', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        throw new Error(j.error || `匯入失敗 (${res.status})`);
      }
      setResult(j);
    } catch (e) {
      setError(e?.message || '匯入失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>批次匯入筆記（Markdown）</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        支援多檔與資料夾上傳（遞迴）；frontmatter 優先，缺值才使用檔名/資料夾補值。
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => filesInputRef.current?.click()}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' }}
        >
          選擇 Markdown 檔案
        </button>
        <button
          type="button"
          onClick={() => dirInputRef.current?.click()}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' }}
        >
          選擇資料夾
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={!items.length || loading}
          style={{
            padding: '8px 12px',
            border: '1px solid #2456ff',
            borderRadius: 8,
            cursor: !items.length || loading ? 'not-allowed' : 'pointer',
            background: !items.length || loading ? '#f5f5f5' : '#2456ff',
            color: !items.length || loading ? '#999' : '#fff',
          }}
        >
          {loading ? '匯入中...' : `開始匯入 (${items.length})`}
        </button>
        <button
          type="button"
          onClick={() => setItems([])}
          disabled={!items.length || loading}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' }}
        >
          清空
        </button>
      </div>

      <input
        ref={filesInputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => addFiles(e.target.files)}
      />
      <input
        ref={dirInputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => addFiles(e.target.files)}
        {...{ webkitdirectory: 'true', directory: 'true' }}
      />

      <div style={{ marginBottom: 12, color: '#444' }}>
        目前檔案：<b>{items.length}</b>，總大小：<b>{toReadableSize(totalSize)}</b>
      </div>

      <div style={{ border: '1px solid #ececec', borderRadius: 8, maxHeight: 220, overflow: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>檔案路徑</th>
              <th style={{ textAlign: 'left', padding: 8, width: 120 }}>大小</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.path} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ padding: 8 }}>{x.path}</td>
                <td style={{ padding: 8 }}>{toReadableSize(x.file?.size || 0)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding: 12, color: '#888' }}>
                  尚未選擇檔案
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <div style={{ color: '#b42318', marginBottom: 12 }}>錯誤：{error}</div>}

      {result && (
        <section style={{ border: '1px solid #e8e8e8', borderRadius: 8, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>匯入結果</h3>
          <p style={{ margin: '8px 0' }}>
            created: <b>{result.summary?.created || 0}</b> / updated: <b>{result.summary?.updated || 0}</b> / failed:{' '}
            <b>{result.summary?.failed || 0}</b> / skipped: <b>{result.summary?.skipped || 0}</b>
          </p>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ textAlign: 'left', padding: 8 }}>檔案</th>
                  <th style={{ textAlign: 'left', padding: 8, width: 100 }}>結果</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>訊息</th>
                  <th style={{ textAlign: 'left', padding: 8, width: 120 }}>slug</th>
                </tr>
              </thead>
              <tbody>
                {(result.results || []).map((r, idx) => (
                  <tr key={`${r.path}-${idx}`} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: 8 }}>{r.path}</td>
                    <td style={{ padding: 8 }}>{r.status}</td>
                    <td style={{ padding: 8 }}>{r.message || '-'}</td>
                    <td style={{ padding: 8 }}>{r.slug || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

