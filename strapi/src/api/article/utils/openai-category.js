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
 * 呼叫 OpenAI 依標題、路徑、摘要、內容與 frontmatter 推斷分類名稱。
 * 優先使用既有分類清單中的名稱；必要時建議簡短新分類名。
 *
 * @param {object} opts
 * @returns {Promise<string>}
 */
async function classifyCategoryWithOpenAI(opts) {
  const {
    apiKey,
    model,
    title,
    relPath,
    description,
    contentSnippet,
    fmSummary,
    existingCategories,
  } = opts;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const names = (existingCategories || [])
    .map((c) => (c?.name || '').toString().trim())
    .filter((n) => n && !['未分類', 'uncategorized', 'default'].includes(n.toLowerCase()));

  const uniqueNames = [...new Set(names)].slice(0, 100);
  const listText = uniqueNames.length ? uniqueNames.join('、') : '（目前尚無可用分類，請建議一個簡短主題分類名稱）';

  const system = `你是筆記庫分類助理。請根據使用者提供的檔案路徑、標題、描述、Markdown 內容摘要與 frontmatter 片段，決定「一個」最合適的分類名稱。

規則：
1. 若下列「既有分類」中有明確符合者，請**完全沿用該分類名稱**（字元需一致）。
2. 若沒有合適的既有分類，請給一個**簡短、可重複使用**的主題分類名稱（例如「Docker」「Azure」「DevOps」），避免把整句標題當分類。
3. 禁止使用「未分類」「筆記」「文章」等過於籠統或無意義的分類。
4. 只輸出 JSON 物件，格式：{"category":"分類名稱"}，不要其他文字。`;

  const user = `【既有分類（優先從中擇一）】
${listText}

【檔案路徑】
${relPath || '-'}

【標題】
${title || '-'}

【描述】
${description || '-'}

【frontmatter 片段（formatter / 結構線索）】
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
  if (!cat) {
    throw new Error('OpenAI returned empty category');
  }
  if (cat.length > 48) {
    return cat.slice(0, 48);
  }
  return cat;
}

module.exports = {
  classifyCategoryWithOpenAI,
  safeFmSummary,
  normalizeCategoryName,
};
