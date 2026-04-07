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

/** 與 Strapi Admin 暗色主題一致之內嵌樣式 */
const D = {
  text: '#f6f6f9',
  muted: '#a5a5ba',
  border: '#4a4a5c',
  bgElevated: '#32324d',
  bgPanel: '#2a2a33',
  bgInput: '#2a2a36',
  bgTableHead: '#2a2a38',
  rowBorder: '#3a3a4c',
  codeBg: '#181825',
  codeColor: '#d0d0ff',
  danger: '#ee5e52',
  progressTrack: '#3a3a4c',
  progressFill: '#4945ff',
  btnPrimary: '#4945ff',
  btnPrimaryDisabled: '#2a2a40',
  btnSecondaryBg: '#32324d',
  btnSecondaryBorder: '#4a4a5c',
  empty: '#8888a0',
  tagBg: 'rgba(105, 105, 255, 0.15)',
  tagBorder: 'rgba(136, 136, 255, 0.35)',
  tagText: '#c0c0ff',
};

const codeInline = {
  background: D.codeBg,
  color: D.codeColor,
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 12,
  border: `1px solid ${D.border}`,
};

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
  const imageExt = (name) => {
    const n = (name || '').toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].some((e) => n.endsWith(e));
  };

  function addFiles(fileList, opts = {}) {
    const { fromDirectory = false } = opts;
    const batchPrefix = fromDirectory ? `pick-${Date.now()}` : null;
    const incoming = Array.from(fileList || [])
      .filter((f) => {
        const n = f?.name?.toLowerCase() || '';
        return n.endsWith('.md') || imageExt(n);
      })
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
    <main style={{ padding: 24, maxWidth: 1100, color: D.text }}>
      <h1 style={{ fontSize: 28, marginBottom: 6, color: D.text }}>批次匯入筆記（Markdown）</h1>
      <p style={{ color: D.muted, marginBottom: 14 }}>
        支援多檔與<strong>多個資料夾</strong>：可重複按「選擇資料夾」累加；若瀏覽器支援，同一對話框內可複選多個資料夾（Chrome／Edge 較常見）。資料夾會遞迴包含 .md 與常見圖片（png／jpg／webp 等）；frontmatter 優先，缺值才使用檔名/路徑補值。
      </p>
      <p style={{ color: D.muted, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        <b>圖片與 MinIO</b>：若後端已設定 <code style={codeInline}>MINIO_*</code> 環境變數，匯入時會將內文 <code style={codeInline}>![](相對路徑)</code>、一般 <code style={codeInline}>![](https://…)</code>（含 BookStack 的{' '}
        <code style={codeInline}>[![](內層)](外層)</code>）之圖片下載或讀檔後上傳至 MinIO（路徑{' '}
        <code style={codeInline}>分類/筆記名稱/timestamp_筆記名稱_流水號.副檔名</code>），並替換為公開 URL。遠端網址會先依{' '}
        <code style={codeInline}>MINIO_REMOTE_SRC_URL_PREFIX</code> → <code style={codeInline}>MINIO_REMOTE_DST_URL_PREFIX</code> 換網域再下載（預設：舊 QNAP 埠 → bookstack.zanehsu.site）。相對路徑圖請與 .md 一併選入同資料夾。
      </p>
      <p style={{ color: D.muted, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        <b>AI 自動生成</b>：匯入時會呼叫 OpenAI（需設定{' '}
        <code style={codeInline}>OPENAI_API_KEY</code>）自動產生<strong>摘要</strong>（description）、<strong>分類</strong>（最多 1 個）與<strong>標籤</strong>（最多 5 個）。
        若 frontmatter 已含 <code style={codeInline}>tags</code>，將優先沿用；未設定 API Key 時分類退回路徑推斷，摘要退回內文首行。
      </p>
      <p style={{ color: D.muted, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        <b>API 使用者（擁有者）</b>：匯入的文章與<strong>自動建立的分類</strong>會歸屬該「使用者與權限」帳號。請從下拉選單選擇；選「使用環境變數預設」時改讀{' '}
        <code style={codeInline}>STRAPI_DEFAULT_ARTICLE_OWNER_ID</code>（或 <code style={codeInline}>STRAPI_IMPORT_DEFAULT_OWNER_ID</code>），皆無則匯入會失敗。
      </p>
      <p style={{ color: D.muted, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        <b>後台清單篩選</b>：內容管理中的文章／分類僅顯示與您<strong>管理員 email 相同</strong>的 API 使用者所擁有之資料（超級管理員除外）。
        請讓「設定 → 管理員」與「使用者與權限 → User」使用同一個 email，或設{' '}
        <code style={codeInline}>STRAPI_CM_OWNER_SCOPE_DISABLED=true</code> 暫時關閉篩選。
      </p>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: D.text }}>
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
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            fontSize: 14,
            background: D.bgInput,
            color: D.text,
          }}
        >
          <option value="">使用環境變數預設（STRAPI_DEFAULT_ARTICLE_OWNER_ID）</option>
          {ownerOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {ownerLoading && <p style={{ margin: '6px 0 0', fontSize: 12, color: D.muted }}>載入使用者清單中…</p>}
        {ownerError && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: D.danger }}>
            無法載入使用者下拉選單：{ownerError}（仍可依環境變數匯入）
          </p>
        )}
      </div>

      <section
        style={{
          border: `1px solid ${D.border}`,
          borderRadius: 10,
          background: D.bgElevated,
          marginBottom: 14,
          padding: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => filesInputRef.current?.click()}
          style={{
            padding: '8px 12px',
            border: `1px solid ${D.btnSecondaryBorder}`,
            borderRadius: 8,
            cursor: 'pointer',
            background: D.btnSecondaryBg,
            color: D.text,
          }}
        >
          選擇 Markdown 檔案
        </button>
        <button
          type="button"
          onClick={() => dirInputRef.current?.click()}
          title="可多次點選以加入多個資料夾；若系統檔案對話框支援，可一次複選多個資料夾"
          style={{
            padding: '8px 12px',
            border: `1px solid ${D.btnSecondaryBorder}`,
            borderRadius: 8,
            cursor: 'pointer',
            background: D.btnSecondaryBg,
            color: D.text,
          }}
        >
          選擇資料夾（可累加／複選）
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={!items.length || loading}
          style={{
            padding: '8px 12px',
            border: `1px solid ${D.btnPrimary}`,
            borderRadius: 8,
            cursor: !items.length || loading ? 'not-allowed' : 'pointer',
            background: !items.length || loading ? D.btnPrimaryDisabled : D.btnPrimary,
            color: '#fff',
            opacity: !items.length || loading ? 0.65 : 1,
          }}
        >
          {loading ? '匯入中...' : `開始匯入 (${items.length})`}
        </button>
        <button
          type="button"
          onClick={() => setItems([])}
          disabled={!items.length || loading}
          style={{
            padding: '8px 12px',
            border: `1px solid ${D.btnSecondaryBorder}`,
            borderRadius: 8,
            cursor: 'pointer',
            background: D.btnSecondaryBg,
            color: D.text,
            opacity: !items.length || loading ? 0.5 : 1,
          }}
        >
          清空
        </button>
          <span style={{ color: D.muted, fontSize: 13, marginLeft: 'auto' }}>
            目前檔案：<b>{items.length}</b>，總大小：<b>{toReadableSize(totalSize)}</b>
          </span>
        </div>

        {loading && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: D.muted, marginBottom: 6 }}>
              <span>{progressLabel || '匯入中...'}</span>
              <b>{progress}%</b>
            </div>
            <div style={{ height: 8, background: D.progressTrack, borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, progress))}%`,
                  height: '100%',
                  background: D.progressFill,
                  transition: 'width 160ms ease',
                }}
              />
            </div>
          </div>
        )}
      </section>

      <section
        style={{
          border: `1px solid ${D.border}`,
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
          background: D.bgPanel,
        }}
      >
        <div style={{ marginBottom: 8, fontWeight: 600, color: D.text }}>分類設定</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: D.text }}>
            <input
              type="radio"
              name="category-mode"
              checked={categoryMode === 'ai'}
              onChange={() => setCategoryMode('ai')}
              disabled={loading}
            />
            AI 自動分類
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: D.text }}>
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
              style={{
                padding: '6px 8px',
                border: `1px solid ${D.border}`,
                borderRadius: 6,
                minWidth: 240,
                background: D.bgInput,
                color: D.text,
              }}
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
              style={{
                padding: '6px 8px',
                border: `1px solid ${D.border}`,
                borderRadius: 6,
                minWidth: 220,
                background: D.bgInput,
                color: D.text,
              }}
            />
            {categoryLoading && <span style={{ color: D.muted }}>分類載入中...</span>}
            {categoryError && <span style={{ color: D.danger }}>分類載入失敗：{categoryError}</span>}
          </div>
        )}
      </section>

      <input
        ref={filesInputRef}
        type="file"
        accept=".md,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,text/markdown,image/*"
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
        accept=".md,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,text/markdown,image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files, { fromDirectory: true });
          e.target.value = '';
        }}
        {...{ webkitdirectory: 'true', directory: 'true' }}
      />

      <section
        style={{
          border: `1px solid ${D.border}`,
          borderRadius: 8,
          maxHeight: 260,
          overflow: 'auto',
          marginBottom: 16,
          background: D.bgElevated,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: D.text }}>
          <thead>
            <tr style={{ background: D.bgTableHead }}>
              <th style={{ textAlign: 'left', padding: 8, color: D.text }}>檔案路徑</th>
              <th style={{ textAlign: 'left', padding: 8, width: 120, color: D.text }}>大小</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.path} style={{ borderTop: `1px solid ${D.rowBorder}` }}>
                <td style={{ padding: 8 }}>{x.path}</td>
                <td style={{ padding: 8 }}>{toReadableSize(x.file?.size || 0)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding: 12, color: D.empty }}>
                  尚未選擇檔案
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {error && (
        <div style={{ color: D.danger, marginBottom: 12 }}>
          錯誤：{error}
        </div>
      )}

      {result && (
        <section
          style={{
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            padding: 12,
            background: D.bgElevated,
            color: D.text,
          }}
        >
          <h3 style={{ marginTop: 0, color: D.text }}>匯入結果</h3>
          <p style={{ margin: '8px 0', color: D.muted }}>
            created: <b>{result.summary?.created || 0}</b> / updated: <b>{result.summary?.updated || 0}</b> / failed:{' '}
            <b>{result.summary?.failed || 0}</b> / skipped: <b>{result.summary?.skipped || 0}</b>
            {typeof result.summary?.minioImagesUploaded === 'number' && result.summary.minioImagesUploaded > 0 ? (
              <>
                {' '}
                / MinIO 圖片替換: <b>{result.summary.minioImagesUploaded}</b>
              </>
            ) : null}
          </p>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: D.text }}>
              <thead>
                <tr style={{ background: D.bgTableHead }}>
                  <th style={{ textAlign: 'left', padding: 8, color: D.text }}>檔案</th>
                  <th style={{ textAlign: 'left', padding: 8, width: 100, color: D.text }}>結果</th>
                  <th style={{ textAlign: 'left', padding: 8, color: D.text }}>訊息</th>
                  <th style={{ textAlign: 'left', padding: 8, width: 120, color: D.text }}>slug</th>
                  <th style={{ textAlign: 'left', padding: 8, width: 160, color: D.text }}>分類</th>
                  <th style={{ textAlign: 'left', padding: 8, width: 200, color: D.text }}>標籤</th>
                  <th style={{ textAlign: 'left', padding: 8, width: 72, color: D.text }}>MinIO</th>
                </tr>
              </thead>
              <tbody>
                {(result.results || []).map((r, idx) => (
                  <tr key={`${r.path}-${idx}`} style={{ borderTop: `1px solid ${D.rowBorder}` }}>
                    <td style={{ padding: 8 }}>{r.path}</td>
                    <td style={{ padding: 8 }}>{r.status}</td>
                    <td style={{ padding: 8 }}>{r.message || '-'}</td>
                    <td style={{ padding: 8 }}>{r.slug || '-'}</td>
                    <td style={{ padding: 8 }}>{r.category || '-'}</td>
                    <td style={{ padding: 8 }}>
                      {Array.isArray(r.tags) && r.tags.length
                        ? r.tags.map((t, ti) => (
                            <span
                              key={ti}
                              style={{
                                display: 'inline-block',
                                margin: '1px 3px 1px 0',
                                padding: '1px 7px',
                                borderRadius: 12,
                                background: D.tagBg,
                                border: `1px solid ${D.tagBorder}`,
                                fontSize: 11,
                                color: D.tagText,
                              }}
                            >
                              {t}
                            </span>
                          ))
                        : <span style={{ color: D.empty }}>-</span>}
                    </td>
                    <td style={{ padding: 8 }}>{typeof r.minioImages === 'number' ? r.minioImages : '-'}</td>
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

