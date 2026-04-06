'use strict';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function normalizeCategoryName(input) {
  return (input || '').toString().trim().replace(/\s+/g, ' ');
}

function safeFmSummary(fm) {
  if (!fm || typeof fm !== 'object') return '';
  try {
    const pick = {};
    const keys = ['tags', 'tag', 'layout', 'type', 'date', 'author', 'draft', 'lang', 'language'];
    for (const k of keys) {
      if (fm[k] !== undefined) pick[k] = fm[k];
    }
    const s = JSON.stringify(pick);
    return s.length > 1500 ? `${s.slice(0, 1500)}…` : s;
  } catch {
    return '';
  }
}

/**
 * 一次呼叫 OpenAI，同時推斷：
 *  - category（分類，最多 1 個）
 *  - description（摘要，100 字以內，純文字，不取內文標題）
 *  - tags（標籤，最多 5 個字串陣列）
 *
 * @param {object} opts
 * @returns {Promise<{ category: string, description: string, tags: string[] }>}
 */
async function classifyWithOpenAI(opts) {
  const {
    apiKey,
    model,
    title,
    relPath,
    description: existingDesc,
    contentSnippet,
    fmSummary,
    existingCategories,
    existingTags,
  } = opts;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const catNames = (existingCategories || [])
    .map((c) => (c?.name || '').toString().trim())
    .filter((n) => n && !['未分類', 'uncategorized', 'default'].includes(n.toLowerCase()));
  const uniqueCatNames = [...new Set(catNames)].slice(0, 100);
  const catListText = uniqueCatNames.length
    ? uniqueCatNames.join('、')
    : '（目前尚無可用分類，請建議一個簡短主題分類名稱）';

  const tagNames = (existingTags || [])
    .map((t) => (t?.name || '').toString().trim())
    .filter(Boolean);
  const uniqueTagNames = [...new Set(tagNames)].slice(0, 200);
  const tagListText = uniqueTagNames.length
    ? uniqueTagNames.join('、')
    : '（目前尚無可用標籤，請自由建議）';

  const system = `你是技術筆記庫的分類助理。請根據使用者提供的資訊，一次輸出三個欄位：

1. **category**（分類名稱，僅一個）
   - 優先從「既有分類」中選最合適者（字元完全一致）。
   - 若無合適的既有分類，建議一個簡短可重複使用的主題名（如「Docker」「Azure」「DevOps」）。
   - 禁止使用「未分類」「筆記」「文章」等過於籠統的詞。

2. **description**（摘要，純文字，不超過 100 個字）
   - 摘要需概述這篇筆記的核心內容或學習重點。
   - 禁止直接複製內文標題（如 "# 簡介"）。
   - 若已有品質良好的摘要，可加以改寫精練；若無意義，請自行生成。

3. **tags**（標籤，字串陣列，最多 5 個）
   - 優先從「既有標籤」中選用（字元完全一致）。
   - 若無合適的既有標籤，可自由建議技術關鍵字（如「REST API」「Kubernetes」「Python」）。
   - 每個標籤 2~20 字，不超過 5 個。

只輸出 JSON 物件，格式：
{"category":"分類名稱","description":"摘要內容","tags":["標籤1","標籤2"]}
不要其他文字。`;

  const user = `【既有分類（優先從中擇一）】
${catListText}

【既有標籤（優先從中擇一）】
${tagListText}

【檔案路徑】
${relPath || '-'}

【標題】
${title || '-'}

【既有描述（若品質差請重寫）】
${existingDesc || '-'}

【frontmatter 片段（結構線索）】
${fmSummary || '-'}

【內容摘要（Markdown 正文節錄）】
${contentSnippet || '-'}`;

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}: ${rawText.slice(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('OpenAI response is not JSON');
  }

  const text = data.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const cat = normalizeCategoryName(parsed.category ?? parsed.name ?? '');
  const desc = (parsed.description || '').toString().trim().slice(0, 500);

  let tags = [];
  if (Array.isArray(parsed.tags)) {
    tags = parsed.tags
      .map((t) => (t || '').toString().trim())
      .filter((t) => t.length >= 1 && t.length <= 50)
      .slice(0, 5);
  }

  if (!cat) {
    throw new Error('OpenAI returned empty category');
  }

  return {
    category: cat.length > 48 ? cat.slice(0, 48) : cat,
    description: desc,
    tags,
  };
}

/**
 * 舊介面相容性保留（只回傳分類名稱字串）
 * @deprecated 建議改用 classifyWithOpenAI
 */
async function classifyCategoryWithOpenAI(opts) {
  const result = await classifyWithOpenAI({ ...opts, existingTags: [] });
  return result.category;
}

module.exports = {
  classifyWithOpenAI,
  classifyCategoryWithOpenAI,
  safeFmSummary,
  normalizeCategoryName,
};
