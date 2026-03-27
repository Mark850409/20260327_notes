import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  const [categoryMode, setCategoryMode] = useState('ai');
  const [manualCategory, setManualCategory] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const totalSize = useMemo(() => items.reduce((s, i) => s + (i.file?.size || 0), 0), [items]);

  useEffect(() => {
    let mounted = true;
    async function loadCategories() {
      setCategoryLoading(true);
      setCategoryError('');
      try {
        const res = await fetch('/api/categories?pagination[pageSize]=200&sort=name:asc', {
          credentials: 'include',
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error(j.error || `分類載入失敗 (${res.status})`);
        const rows = Array.isArray(j?.data) ? j.data : [];
        const mapped = rows
          .map((row) => {
            const attrs = row?.attributes || row || {};
            const name = (attrs?.name || '').toString().trim();
            if (!name) return null;
            return { value: name, label: name };
          })
          .filter(Boolean);
        if (mounted) {
          setCategoryOptions(mapped);
          if (mapped.length && !manualCategory) setManualCategory(mapped[0].value);
        }
      } catch (e) {
        if (mounted) setCategoryError(e?.message || '分類載入失敗');
      } finally {
        if (mounted) setCategoryLoading(false);
      }
    }
    loadCategories();
    return () => {
      mounted = false;
    };
  }, []);

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

  function uploadImportWithProgress(formData) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/articles/import-markdown');
      xhr.withCredentials = true;

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.max(1, Math.min(95, Math.round((event.loaded / event.total) * 95)));
        setProgress(percent);
        setProgressLabel(`檔案上傳中... ${percent}%`);
      };

      xhr.onerror = () => reject(new Error('網路錯誤，匯入失敗'));
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText || '{}');
          if (xhr.status < 200 || xhr.status >= 300 || json.error) {
            reject(new Error(json.error || `匯入失敗 (${xhr.status})`));
            return;
          }
          resolve(json);
        } catch {
          reject(new Error('回應格式錯誤，匯入失敗'));
        }
      };

      xhr.send(formData);
    });
  }

  async function onImport() {
    if (!items.length || loading) return;
    if (categoryMode === 'manual' && !manualCategory) {
      setError('手動分類模式需要先選擇分類');
      return;
    }
    setLoading(true);
    setProgress(1);
    setProgressLabel('準備匯入...');
    setError('');
    setResult(null);
    try {
      const fd = new FormData();
      const paths = items.map((x) => x.path);
      for (const x of items) {
        fd.append('files', x.file, x.file.name);
      }
      fd.append('relativePaths', JSON.stringify(paths));
      fd.append('categoryMode', categoryMode);
      if (categoryMode === 'manual') fd.append('manualCategory', manualCategory);

      const j = await uploadImportWithProgress(fd);
      setProgress(97);
      setProgressLabel('伺服器處理中...');
      setResult(j);
      setProgress(100);
      setProgressLabel('匯入完成');
    } catch (e) {
      setError(e?.message || '匯入失敗');
      setProgressLabel('匯入失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>批次匯入筆記（Markdown）</h1>
      <p style={{ color: '#666', marginBottom: 14 }}>
        支援多檔與資料夾上傳（遞迴）；frontmatter 優先，缺值才使用檔名/資料夾補值。
      </p>

      <section
        style={{
          border: '1px solid #e8e8ef',
          borderRadius: 10,
          background: '#fff',
          marginBottom: 14,
          padding: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => filesInputRef.current?.click()}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff' }}
        >
          選擇 Markdown 檔案
        </button>
        <button
          type="button"
          onClick={() => dirInputRef.current?.click()}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff' }}
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
          <span style={{ color: '#666', fontSize: 13, marginLeft: 'auto' }}>
            目前檔案：<b>{items.length}</b>，總大小：<b>{toReadableSize(totalSize)}</b>
          </span>
        </div>

        {loading && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 6 }}>
              <span>{progressLabel || '匯入中...'}</span>
              <b>{progress}%</b>
            </div>
            <div style={{ height: 8, background: '#f0f1f5', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, progress))}%`,
                  height: '100%',
                  background: '#4945ff',
                  transition: 'width 160ms ease',
                }}
              />
            </div>
          </div>
        )}
      </section>

      <section style={{ border: '1px solid #ececec', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>分類設定</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="radio"
              name="category-mode"
              checked={categoryMode === 'ai'}
              onChange={() => setCategoryMode('ai')}
              disabled={loading}
            />
            AI 自動分類
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="radio"
              name="category-mode"
              checked={categoryMode === 'manual'}
              onChange={() => setCategoryMode('manual')}
              disabled={loading}
            />
            手動指定分類
          </label>
        </div>
        {categoryMode === 'manual' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value)}
              disabled={loading || categoryLoading}
              style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, minWidth: 240 }}
            >
              {!categoryOptions.length && <option value="">尚無可用分類（匯入時會自動建立）</option>}
              {categoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="或輸入新分類名稱"
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value)}
              disabled={loading}
              style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, minWidth: 220 }}
            />
            {categoryLoading && <span style={{ color: '#666' }}>分類載入中...</span>}
            {categoryError && <span style={{ color: '#b42318' }}>分類載入失敗：{categoryError}</span>}
          </div>
        )}
      </section>

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

      <section style={{ border: '1px solid #ececec', borderRadius: 8, maxHeight: 260, overflow: 'auto', marginBottom: 16, background: '#fff' }}>
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
      </section>

      {error && <div style={{ color: '#b42318', marginBottom: 12 }}>錯誤：{error}</div>}

      {result && (
        <section style={{ border: '1px solid #e8e8e8', borderRadius: 8, padding: 12, background: '#fff' }}>
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
                  <th style={{ textAlign: 'left', padding: 8, width: 180 }}>分類</th>
                </tr>
              </thead>
              <tbody>
                {(result.results || []).map((r, idx) => (
                  <tr key={`${r.path}-${idx}`} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: 8 }}>{r.path}</td>
                    <td style={{ padding: 8 }}>{r.status}</td>
                    <td style={{ padding: 8 }}>{r.message || '-'}</td>
                    <td style={{ padding: 8 }}>{r.slug || '-'}</td>
                    <td style={{ padding: 8 }}>{r.category || '-'}</td>
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

