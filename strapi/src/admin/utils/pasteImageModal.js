/**
 * 貼圖上傳前：自訂檔名、可選建立／使用根層資料夾名稱。
 * 以純 DOM 實作，避免在 bootstrap 內掛載 React root。
 *
 * backdrop 與 panel 必須為 body 下同層兄弟，且 panel z-index 高於 backdrop，
 * 否則在 Strapi 後台（flex 堆疊、側欄）下可能出現遮罩蓋住對話框或無法點擊。
 */

import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const Z_BACKDROP = 2147483646;
const Z_PANEL = 2147483647;

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
 * @param {number} [opts.index] 多檔時顯示第幾張（1-based）
 * @param {number} [opts.total]
 * @returns {Promise<{ fileName: string, useFolder: boolean, folderName: string } | null>}
 */
export function openPasteImageUploadDialog(opts) {
  const { defaultFileName, index, total } = opts || {};
  const baseDefault = defaultFileName || `${Date.now()}.png`;
  const title =
    total > 1 ? `上傳貼圖（第 ${index} / ${total} 張）` : '上傳貼圖';

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.setAttribute('role', 'presentation');
    backdrop.style.cssText = [
      `position:fixed;inset:0;background:rgba(15,15,20,0.55);z-index:${Z_BACKDROP}`,
      'pointer-events:auto;',
    ].join('');

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.style.cssText = [
      `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:${Z_PANEL}`,
      'max-height:min(90vh,640px);overflow:auto;max-width:420px;width:calc(100vw - 32px);',
      'background:#fff;color:#212134;border-radius:8px;',
      'box-shadow:0 8px 32px rgba(0,0,0,0.2);font-family:system-ui,sans-serif;font-size:14px;',
      'pointer-events:auto;isolation:isolate;',
    ].join('');

    panel.innerHTML = `
      <div style="padding:20px 20px 12px;border-bottom:1px solid #eaeaef;">
        <div style="font-weight:600;font-size:16px;">${esc(title)}</div>
        <div style="margin-top:6px;color:#666;font-size:13px;">設定媒體庫檔名與資料夾後再上傳。</div>
      </div>
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px;">
        <label style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-weight:500;">檔名</span>
          <input type="text" data-field="fileName" value="${esc(baseDefault)}"
            style="padding:8px 10px;border:1px solid #dcdce4;border-radius:4px;font-size:14px;" />
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
          <input type="checkbox" data-field="useFolder" />
          <span>放入媒體庫資料夾（若無同名資料夾則建立）</span>
        </label>
        <label style="display:flex;flex-direction:column;gap:6px;opacity:0.5;pointer-events:none;" data-folder-wrap>
          <span style="font-weight:500;">資料夾名稱</span>
          <input type="text" data-field="folderName" placeholder="例如：文章插圖"
            style="padding:8px 10px;border:1px solid #dcdce4;border-radius:4px;font-size:14px;" disabled />
        </label>
      </div>
      <div style="padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #eaeaef;">
        <button type="button" data-action="cancel" style="padding:8px 14px;border-radius:4px;border:1px solid #dcdce4;background:#fff;cursor:pointer;">取消</button>
        <button type="button" data-action="ok" style="padding:8px 14px;border-radius:4px;border:none;background:#4945ff;color:#fff;cursor:pointer;font-weight:500;">上傳</button>
      </div>
    `;

    const fileNameInput = panel.querySelector('[data-field="fileName"]');
    const useFolderEl = panel.querySelector('[data-field="useFolder"]');
    const folderNameInput = panel.querySelector('[data-field="folderName"]');
    const folderWrap = panel.querySelector('[data-folder-wrap]');

    const syncFolderEnabled = () => {
      const on = useFolderEl.checked;
      folderWrap.style.opacity = on ? '1' : '0.5';
      folderWrap.style.pointerEvents = on ? 'auto' : 'none';
      folderNameInput.disabled = !on;
      if (on) folderNameInput.focus();
    };
    useFolderEl.addEventListener('change', syncFolderEnabled);

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
      const useFolder = useFolderEl.checked;
      const folderName = (folderNameInput.value || '').trim();
      if (!fileName) {
        void Swal.fire({
          icon: 'warning',
          title: '請輸入檔名',
          confirmButtonText: '確定',
        });
        return;
      }
      if (useFolder && !folderName) {
        void Swal.fire({
          icon: 'warning',
          title: '請輸入資料夾名稱',
          text: '已勾選資料夾時，請輸入資料夾名稱。',
          confirmButtonText: '確定',
        });
        return;
      }
      finish({
        fileName,
        useFolder,
        folderName: useFolder ? folderName : '',
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
