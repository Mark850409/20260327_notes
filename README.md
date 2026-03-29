# My Notes

以 **Astro（SSR）**、**Flask**、**Strapi 5** 與 **MySQL** 建置的個人筆記／知識庫網站。前端採文件站風格（側欄導覽、搜尋、分類與 Markdown 文章），API 由 Flask 代理 Strapi 內容，Nginx 統一對外入口。

## 架構

```
瀏覽器 → Nginx :80
         ├─ /           → Astro（frontend :4321）
         ├─ /api/       → Flask（backend :5000）→ Strapi REST
         └─ /admin 等   → Strapi（:1337）
```

| 目錄 | 說明 |
|------|------|
| `frontend/` | Astro 5 + Vue islands，SSR，`/notes/[slug]`、`/categories/[cat]` |
| `backend/` | Flask + OpenAPI，轉發 Strapi `/api/articles` 等 |
| `strapi/` | Strapi 5 CMS，內容型別與 Schema 在 `strapi/src` |
| `nginx/` | 反向代理設定 |
| `mysql/` | 資料庫初始化腳本（若使用） |

## 需求

- Docker 與 Docker Compose
- （選用）本機開發前端時需 Node 20+

## 快速開始

1. **複製環境變數**

   ```bash
   cp .env.example .env
   ```

   編輯 `.env`，至少設定 MySQL 與 Strapi 相關密鑰（`STRAPI_*` 請勿使用範例預設值）。

2. **建置並啟動**

   ```bash
   docker compose up -d --build
   ```

3. **開啟服務**

   | 用途 | 網址 |
   |------|------|
   | 網站入口（主站） | 預設 `http://localhost`；若 `.env` 設定 `NGINX_HTTP_PORT=9080` 等自訂埠，請用 **`http://localhost:該埠`**（勿省略埠，否則會連到 80 而拒絕連線） |
   | Strapi 管理後台 | 同上主站網址後接 `/admin`（例如 `http://localhost:9080/admin`） |
   | Strapi API（直連） | http://localhost:1337 |
   | Flask API（直連） | http://localhost:5000/api/health |
   | Astro（直連，除錯用） | http://localhost:4321 |

首次使用請至 Strapi 建立**管理員**帳號；另在 **Settings → Users & Permissions → Users** 建立至少一個**前台／API 使用者**（與管理員不同），用於網站登入。

**Content API 權限（必做）**

1. **Public**：取消勾選 **Article**、**Category** 的 `find`、`findOne`（未登入不可讀）。
2. **Authenticated**（或你的自訂角色）：勾選 **Article**、**Category** 的 `find`／`findOne`，以及 **Site-profile** `find`（單一型別）。

**文章**與**分類**皆已新增 **owner**（擁有者）：REST 建立時會自動帶入目前 JWT 使用者；前台僅會看到自己擁有的分類。內容管理員手動建立時請指定擁有者，或設定環境變數 `STRAPI_DEFAULT_ARTICLE_OWNER_ID`（文章與分類新建未填時皆會套用）。

後台「批次匯入筆記」的分類下拉選單改為呼叫 **Content Manager** API（沿用管理員登入），不依賴公開 `/api/categories`；匯入時建立／配對的分類會帶入該次匯入的 **API 使用者 ID（ownerId）**。若與其他使用者撞 `slug`，會自動改為 `原slug-u{ownerId}`。

網站入口會導向 `/login`，登入成功後 Flask 會寫入 HttpOnly Cookie `notes_auth`，SSR 會轉發至 Strapi。

升級後若資料庫裡已有文章或分類但 **owner 為空**，前台不會顯示；請在內容管理員補上擁有者，或刪除後重建。

登入後仍看不到文章時，請確認該篇 **擁有者** 與你登入的 **API 使用者**為同一人（後台列表「OWNER」欄位）；文章 API 已改為用 `entityService` 依 `owner.id` 篩選，與 JWT 的 `id` 必須一致。

## 環境變數摘要

請以 `.env.example` 為準；常見項目包括：

- **MySQL**：`MYSQL_*`、`DATABASE_URL`（Flask 讀取與 Strapi 相同資料庫）
- **Strapi**：`STRAPI_JWT_SECRET`、`STRAPI_APP_KEYS` 等
- **媒體公開網址**：`STRAPI_PUBLIC_URL`（預設 `http://localhost:1337`，供前端顯示上傳圖片）
- **前端**：`PUBLIC_SITE_TITLE`、`PUBLIC_SITE_DESCRIPTION`（建置時注入）

Docker 內建之 `API_BASE` 指向 `http://backend:5000`，與 Compose 服務名稱一致。

## 本機開發（僅前端）

```bash
cd frontend
npm install
npm run dev
```

若未透過 Docker 跑後端，請在 `frontend/.env` 或環境變數設定可連線的 `API_BASE`（例如 `http://127.0.0.1:5000`），否則 SSR 無法取得文章資料。

## 疑難排解

- **文章 404**：確認 Flask 路由為 `/api/articles/<string:slug>` 已部署；單篇文章由 Flask 向 Strapi 查詢 `slug`／`title`。詳見 `frontend/docs/404-troubleshooting.md`。
- **Strapi 後台語言**：繁體介面請在 `strapi/src/admin/app.js` 設定 `locales: ['zh']`（內建 `zh.json` 為繁體），重建 Admin 後於使用者設定選擇介面語言。

## 後台與前台欄位對應

### 文章發布（Article）

- **Strapi 後台位置**：`Content Manager -> Article`
- **核心欄位**
  - `title`：前台文章標題（列表與單篇頁）
  - `slug`：前台網址 `/notes/{slug}`
  - `description`：列表摘要與單篇前言
  - `content`：Markdown 正文（由後端轉為 HTML）
  - `category`：分類頁與文章分類標籤
- **發布流程**
  1. 在 Strapi 新增或編輯文章
  2. 點擊 Publish
  3. 前台透過 Flask API 即時讀取（SSR）

### 網站設定（Site Profile）

- **Strapi 後台位置**：`Content Manager -> Site Profile`（Single Type）
- **欄位與前台用途**
  - `authorLabel`：側欄作者區小標（如 `Author`）
  - `avatar`：作者頭像（上傳圖片後顯示在作者區塊最上方）
  - `displayName`：側欄作者名稱（頭像下方小字）
  - `siteTitle`：側欄上方網站主標題（大字）
  - `motto`：作者一句話
  - `quote` / `quoteSource`：側欄引言與來源
  - `socialLinks[]`：側欄社群連結（label/url/iconKey）
  - `licenseImageUrl` / `licenseHtml`：側欄授權區塊
  - `postsPerPage`：文章列表每頁顯示筆數（首頁與分類頁）
- **前台 API**
  - 前台讀取 `GET /api/site-profile`（Flask 代理 Strapi）
- **權限**
  - Strapi `Public` 角色需開啟 Site Profile 的 `find`

## 批次匯入筆記（Markdown）

### 後台入口

- 進入 Strapi 後台後，左側選單點擊 `批次匯入筆記`。
- 可選擇：
  - 多個 `.md` 檔案
  - 一整個資料夾（遞迴）

### 欄位對應規則

- `frontmatter` 優先：
  - `title`, `slug`, `description`, `category`
- 缺值 fallback：
  - `title`：檔名（去除 `.md`）
  - `slug`：由 `title` / 檔名 slugify
  - `description`：內容第一行摘要
  - `category`：資料夾第一層名稱

### 重複 slug 策略

- 若已存在同 `slug` 文章：**更新現有文章**
- 若不存在：建立新文章

### 驗收清單

1. 在匯入頁看到摘要：`created / updated / failed / skipped`。
2. 回到 `Content Manager -> Article` 清單，確認新增/更新可見。
3. 打開前台首頁與文章頁，確認內容正確渲染（標題、段落、清單、程式碼）。

### 常見錯誤

- 只接受 `.md`：其他副檔名會被 `skipped`
- frontmatter 格式錯誤：該檔案會標記 `failed`
- 權限不足：若 API 被封鎖，請確認後台是否可呼叫 `/api/articles/import-markdown`

### 固定測試集與 E2E

- 測試資料集位於 `sample_import/`，含：
  - `new-post.md`（新增）
  - `existing-slug.md`（更新）
  - `folderA/post-with-category.md`（資料夾分類 fallback）
- 端到端驗收步驟詳見 `sample_import/README.md`。

## 授權

專案私有用途；依各依賴套件授權為準。
