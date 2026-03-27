# sample_import 驗收資料集

固定測試檔：

- `new-post.md`：應新增（created）
- `existing-slug.md`：若同 slug 已存在，應更新（updated）
- `folderA/post-with-category.md`：未填 category，應 fallback 使用 `folderA`

端到端驗收步驟：

1. Strapi 後台 `批次匯入筆記` 上傳 `sample_import/`。
2. 檢查回傳摘要（created / updated / failed / skipped）。
3. 開啟 `Content Manager -> Article`：
   - 確認可見新文章
   - 確認同 slug 文章內容已更新
4. 開前台首頁：確認文章列表與分頁可見。
5. 開前台分類頁：確認 `folderA`（或其 slug）分類可見。
6. 開文章頁：確認 Markdown 渲染（標題、段落、清單、程式碼）。

