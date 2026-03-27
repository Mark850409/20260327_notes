# 404 排查（Astro → Flask → Strapi）

## 如何區分「被導向 404」與「直接開 /404」

| 情境 | 網址列 | HTTP 狀態（實作後） |
|------|--------|---------------------|
| 從首頁／分類點文章，但 slug 在後端查不到 | 先為 `/notes/<slug>`，回應為 **404** 並顯示錯誤頁內容（網址可維持 `/notes/<slug>`） | **404** |
| 在瀏覽器直接輸入 `/404` 或書籤 | `.../404` | **200**（仍為自訂 404 文案頁） |

若需確認是否為「文章不存在」：對本機 Flask 打 `GET http://localhost:5000/api/articles/<slug>`（見 `docker-compose` 是否有對外 `5000`），若回 **404** 代表後端查無該 slug。

## Strapi 端請核對

1. **Published**：Strapi 5 的 REST 預設只回已發布文件；草稿需帶 `status=draft`。後端已移除 v4 的 `publicationState=live`（在 v5 可能導致篩選異常）。
2. **slug 與標題**：側邊欄顯示的是**標題**，網址預設走 **slug**（見 `Sidebar.vue` 的 `/notes/${art.slug}`）。若標題與 slug 不同（例如標題 `adasd`、slug `asdas`），請用 `/notes/asdas` 開啟；後端單篇 API 亦支援以**與標題完全相同**的路徑查詢，故 `/notes/adasd` 也可對應同一篇。
3. **權限**：若曾調整 Strapi Public role，需確認 `article` 的 `find`／`findOne` 允許匿名或與 Flask 使用的 token 一致。

## 後端開發注意（flask-openapi3）

動態路徑須寫成 **Flask 語法** `/<string:slug>`，勿使用 OpenAPI 風格的 `/{slug}` 當成 `add_url_rule` 的規則，否則 Werkzeug 會把 `{slug}` 當成字面字元，導致 `GET /api/articles/<任意 slug>` 全部回傳 **HTML 404**（不是 JSON）。
