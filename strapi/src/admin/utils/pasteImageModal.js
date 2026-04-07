/**
 * 貼圖上傳前：可選 Strapi 媒體庫或 MinIO；巢狀路徑、檔名可編輯。
 * 以純 DOM 實作，避免在 bootstrap 內掛載 React root。
 */

import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const Z_BACKDROP = 2147483646;
const Z_PANEL = 2147483647;

const D = {
  bg: '#32324d',
  border: '#4a4a5c',
  text: '#f6f6f9',
  muted: '#a5a5ba',
  inputBg: '#2a2a36',
  accent: '#4945ff',
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} opts
 * @param {string} opts.defaultFileName
 * @param {string} [opts.defaultMinioPathPrefix] MinIO 物件路徑前綴（巢狀目錄，不含檔名）
 * @param {number} [opts.index] 多檔時顯示第幾張（1-based）
 * @param {number} [opts.total]
 * @returns {Promise<{ mode: 'media'|'minio', fileName: string, useFolder: boolean, folderName: string, minioPathPrefix: string } | null>}
 */
export function openPasteImageUploadDialog(opts) {
  const { defaultFileName, defaultMinioPathPrefix = '', index, total } = opts || {};
  const baseDefault = defaultFileName || `${Date.now()}.png`;
  const title =
    total > 1 ? `上傳貼圖（第 ${index} / ${total} 張）` : '上傳貼圖';

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.setAttribute('role', 'presentation');
    backdrop.style.cssText = [
      `position:fixed;inset:0;background:rgba(10,10,16,0.65);z-index:${Z_BACKDROP}`,
      'pointer-events:auto;',
    ].join('');

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.style.cssText = [
      `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:${Z_PANEL}`,
      'max-height:min(90vh,720px);overflow:auto;max-width:440px;width:calc(100vw - 32px);',
      `background:${D.bg};color:${D.text};border-radius:10px;border:1px solid ${D.border};`,
      'box-shadow:0 12px 40px rgba(0,0,0,0.45);font-family:system-ui,sans-serif;font-size:14px;',
      'pointer-events:auto;isolation:isolate;',
    ].join('');

    panel.innerHTML = `
      <div style="padding:18px 20px 12px;border-bottom:1px solid ${D.border};">
        <div style="font-weight:600;font-size:16px;">${esc(title)}</div>
        <div style="margin-top:6px;color:${D.muted};font-size:13px;line-height:1.45;">
          選擇上傳至 Strapi 媒體庫，或直接寫入 MinIO（可巢狀目錄）。檔名可改；留空預設為時間戳_標題_流水號。
        </div>
      </div>
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;flex-direction:column;gap:8px;">
          <span style="font-weight:500;font-size:13px;color:${D.muted};">目標</span>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
              <input type="radio" name="paste-target-mode" value="media" checked data-mode-media />
              <span>Strapi 媒體庫</span>
            </label>
            <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
              <input type="radio" name="paste-target-mode" value="minio" data-mode-minio />
              <span>MinIO（自訂路徑）</span>
            </label>
          </div>
        </div>
        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:500;">檔名</span>
          <input type="text" data-field="fileName" value="${esc(baseDefault)}"
            style="padding:9px 11px;border:1px solid ${D.border};border-radius:6px;font-size:14px;background:${D.inputBg};color:${D.text};" />
        </label>
        <div data-section-media>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-bottom:10px;">
            <input type="checkbox" data-field="useFolder" />
            <span>放入媒體庫資料夾（若無同名資料夾則建立）</span>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;opacity:0.45;pointer-events:none;" data-folder-wrap>
            <span style="font-weight:500;">資料夾名稱</span>
            <input type="text" data-field="folderName" placeholder="例如：文章插圖"
              style="padding:9px 11px;border:1px solid ${D.border};border-radius:6px;font-size:14px;background:${D.inputBg};color:${D.text};" disabled />
          </label>
        </div>
        <div data-section-minio style="display:none;flex-direction:column;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-weight:500;">MinIO 路徑前綴（巢狀目錄）</span>
            <input type="text" data-field="minioPathPrefix" value="${esc(defaultMinioPathPrefix)}"
              placeholder="例如：分類名稱/筆記標題 或 my-folder/sub"
              style="padding:9px 11px;border:1px solid ${D.border};border-radius:6px;font-size:14px;background:${D.inputBg};color:${D.text};" />
            <span style="font-size:12px;color:${D.muted};line-height:1.4;">不含檔名；使用 / 分隔多層資料夾。可留空（檔案在 bucket 根目錄）。</span>
          </label>
        </div>
      </div>
      <div style="padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid ${D.border};">
        <button type="button" data-action="cancel" style="padding:8px 14px;border-radius:6px;border:1px solid ${D.border};background:${D.inputBg};color:${D.text};cursor:pointer;">取消</button>
        <button type="button" data-action="ok" style="padding:8px 14px;border-radius:6px;border:none;background:${D.accent};color:#fff;cursor:pointer;font-weight:500;">上傳</button>
      </div>
    `;

    const fileNameInput = panel.querySelector('[data-field="fileName"]');
    const useFolderEl = panel.querySelector('[data-field="useFolder"]');
    const folderNameInput = panel.querySelector('[data-field="folderName"]');
    const folderWrap = panel.querySelector('[data-folder-wrap]');
    const sectionMedia = panel.querySelector('[data-section-media]');
    const sectionMinio = panel.querySelector('[data-section-minio]');
    const minioPathInput = panel.querySelector('[data-field="minioPathPrefix"]');
    const modeMedia = panel.querySelector('[data-mode-media]');
    const modeMinio = panel.querySelector('[data-mode-minio]');

    const syncFolderEnabled = () => {
      const on = useFolderEl.checked;
      folderWrap.style.opacity = on ? '1' : '0.45';
      folderWrap.style.pointerEvents = on ? 'auto' : 'none';
      folderNameInput.disabled = !on;
      if (on) folderNameInput.focus();
    };
    useFolderEl.addEventListener('change', syncFolderEnabled);

    const syncModeUi = () => {
      const minio = modeMinio.checked;
      sectionMedia.style.display = minio ? 'none' : 'block';
      sectionMinio.style.display = minio ? 'flex' : 'none';
      if (minio) {
        setTimeout(() => minioPathInput.focus(), 0);
      }
    };
    modeMedia.addEventListener('change', syncModeUi);
    modeMinio.addEventListener('change', syncModeUi);

    const cleanup = () => {
      panel.remove();
      backdrop.remove();
      const prev = document.body.dataset.notesOverflow;
      if (prev !== undefined) {
        document.body.style.overflow = prev || '';
        delete document.body.dataset.notesOverflow;
      } else {
        document.body.style.overflow = '';
      }
      document.removeEventListener('keydown', onKey);
    };

    const finish = (value) => {
      cleanup();
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };

    panel.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
    panel.querySelector('[data-action="ok"]').addEventListener('click', () => {
      const fileName = (fileNameInput.value || '').trim();
      const mode = modeMinio.checked ? 'minio' : 'media';
      const useFolder = useFolderEl.checked;
      const folderName = (folderNameInput.value || '').trim();
      const minioPathPrefix = (minioPathInput.value || '').trim();

      if (!fileName) {
        void Swal.fire({
          icon: 'warning',
          title: '請輸入檔名',
          confirmButtonText: '確定',
        });
        return;
      }
      if (mode === 'media' && useFolder && !folderName) {
        void Swal.fire({
          icon: 'warning',
          title: '請輸入資料夾名稱',
          text: '已勾選媒體庫資料夾時，請輸入資料夾名稱。',
          confirmButtonText: '確定',
        });
        return;
      }

      finish({
        mode,
        fileName,
        useFolder,
        folderName: useFolder ? folderName : '',
        minioPathPrefix: mode === 'minio' ? minioPathPrefix : '',
      });
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish(null);
    });

    document.addEventListener('keydown', onKey);
    if (!document.body.dataset.notesOverflow) {
      document.body.dataset.notesOverflow = document.body.style.overflow || '';
    }
    document.body.style.overflow = 'hidden';
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    setTimeout(() => fileNameInput.focus(), 0);
    fileNameInput.select();
  });
}
