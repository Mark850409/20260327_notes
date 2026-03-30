import React, { useEffect, useMemo, useRef, useState } from 'react';

function toReadableSize(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 後台自訂 API 與 CM 請求：附 Cookie，並盡量帶上 admin JWT（Strapi 多存在 localStorage jwtToken） */
function notesImportFetchInit() {
  const headers = { Accept: 'application/json' };
  try {
    const raw =
      (typeof localStorage !== 'undefined' && localStorage.getItem('jwtToken')) ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('jwtToken')) ||
      null;
    if (raw) {
      let token = raw;
      try {
        token = JSON.parse(raw);
      } catch {
        /* 已是純字串 */
      }
      if (typeof token === 'string' && token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
      }
    }
  } catch {
    /* ignore */
  }
  return { credentials: 'include', headers };
}

/** Content Manager 列 → 匯入用 ownerId（數字 id）與顯示標籤 */
function mapCmUserRow(row) {
  const attrs = row?.attributes || row || {};
  const id = row?.id ?? attrs?.id;
  if (id == null || id === '') return null;
  const username = (attrs?.username ?? row?.username ?? '').toString().trim();
  const email = (attrs?.email ?? row?.email ?? '').toString().trim();
  let label = '';
  if (username && email) label = `${username} · ${email}`;
  else label = username || email || `使用者（id ${id}）`;
  return { value: String(id), label };
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
  const [ownerUserId, setOwnerUserId] = useState('');
  const [ownerOptions, setOwnerOptions] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState('');

  const totalSize = useMemo(() => items.reduce((s, i) => s + (i.file?.size || 0), 0), [items]);

  useEffect(() => {
    let mounted = true;
    async function loadCmData() {
      setCategoryLoading(true);
      setOwnerLoading(true);
      setCategoryError('');
      setOwnerError('');
      const catUid = encodeURIComponent('api::category.category');
      const catUrl = `/content-manager/collection-types/${catUid}?page=1&pageSize=200&sort=name:ASC`;
      const userUrl = '/notes-import/api-users';

      try {
        const res = await fetch(catUrl, notesImportFetchInit());
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error(j.error?.message || j.error || `分類載入失敗 (${res.status})`);
        const rows = Array.isArray(j.results) ? j.results : Array.isArray(j.data) ? j.data : [];
        const mapped = rows
          .map((row) => {
            const attrs = row?.attributes || row || {};
            const name = (attrs?.name ?? row?.name ?? '').toString().trim();
            if (!name) return null;
            return { value: name, label: name };
          })
          .filter(Boolean);
        if (mounted) {
          setCategoryOptions(mapped);
          setManualCategory((prev) => (prev || (mapped.length ? mapped[0].value : '')));
        }
      } catch (e) {
        if (mounted) setCategoryError(e?.message || '分類載入失敗');
      }

      try {
        const res = await fetch(userUrl, notesImportFetchInit());
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          const msg = j.error?.message || j.error || `使用者清單載入失敗 (${res.status})`;
          throw new Error(msg);
        }
        const rows = Array.isArray(j.data) ? j.data : [];
        const mapped = rows.map(mapCmUserRow).filter(Boolean);
        if (mounted) setOwnerOptions(mapped);
      } catch (e) {
        if (mounted) setOwnerError(e?.message || '使用者清單載入失敗');
      }

      if (mounted) {
        setCategoryLoading(false);
        setOwnerLoading(false);
      }
    }
    loadCmData();
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * @param {FileList|null|undefined} fileList
   * @param {{ fromDirectory?: boolean }} [opts] 資料夾模式：每次選取加時間前綴，避免多個資料夾內相同相對路徑互蓋；可重複按鈕累加多個資料夾。
   */
  function addFiles(fileList, opts = {}) {
    const { fromDirectory = false } = opts;
    const batchPrefix = fromDirectory ? `pick-${Date.now()}` : null;
    const incoming = Array.from(fileList || [])
      .filter((f) => f?.name?.toLowerCase()?.endsWith('.md'))
      .map((f) => {
        const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
        const path = batchPrefix ? `${batchPrefix}/${rel}` : rel;
        return { file: f, path };
      });
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
      const oid = (ownerUserId || '').toString().trim();
      if (oid) fd.append('ownerId', oid);

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
        支援多檔與<strong>多個資料夾</strong>：可重複按「選擇資料夾」累加；若瀏覽器支援，同一對話框內可複選多個資料夾（Chrome／Edge 較常見）。資料夾會遞迴包含 .md；frontmatter 優先，缺值才使用檔名/路徑補值。
      </p>
      <p style={{ color: '#666', marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        <b>API 使用者（擁有者）</b>：匯入的文章與<strong>自動建立的分類</strong>會歸屬該「使用者與權限」帳號。請從下拉選單選擇；選「使用環境變數預設」時改讀{' '}
        <code>STRAPI_DEFAULT_ARTICLE_OWNER_ID</code>（或 <code>STRAPI_IMPORT_DEFAULT_OWNER_ID</code>），皆無則匯入會失敗。
      </p>
      <p style={{ color: '#666', marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        <b>後台清單篩選</b>：內容管理中的文章／分類僅顯示與您<strong>管理員 email 相同</strong>的 API 使用者所擁有之資料（超級管理員除外）。
        請讓「設定 → 管理員」與「使用者與權限 → User」使用同一個 email，或設{' '}
        <code>STRAPI_CM_OWNER_SCOPE_DISABLED=true</code> 暫時關閉篩選。
      </p>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          API 使用者（選填，與環境變數擇一）
        </label>
        <select
          value={ownerUserId}
          onChange={(e) => setOwnerUserId(e.target.value)}
          disabled={loading || ownerLoading}
          style={{
            width: '100%',
            maxWidth: 480,
            padding: '10px 12px',
            border: '1px solid #dcdce4',
            borderRadius: 8,
            fontSize: 14,
            background: '#fff',
          }}
        >
          <option value="">使用環境變數預設（STRAPI_DEFAULT_ARTICLE_OWNER_ID）</option>
          {ownerOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {ownerLoading && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#666' }}>載入使用者清單中…</p>}
        {ownerError && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#b42318' }}>
            無法載入使用者下拉選單：{ownerError}（仍可依環境變數匯入）
          </p>
        )}
      </div>

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
          title="可多次點選以加入多個資料夾；若系統檔案對話框支援，可一次複選多個資料夾"
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff' }}
        >
          選擇資料夾（可累加／複選）
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
        onChange={(e) => {
          addFiles(e.target.files, { fromDirectory: false });
          e.target.value = '';
        }}
      />
      <input
        ref={dirInputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files, { fromDirectory: true });
          e.target.value = '';
        }}
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

