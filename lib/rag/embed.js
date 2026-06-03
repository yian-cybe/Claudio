/**
 * RAG 嵌入模块 — 调用 OpenAI 兼容 `/v1/embeddings` 接口
 *
 * - 复用 OPENAI_API_KEY / OPENAI_BASE_URL
 * - 可通过 EMBEDDING_API_KEY / EMBEDDING_BASE_URL / EMBEDDING_MODEL 独立配置
 * - 向量 L2 归一化，API 不可用时返回 null 不阻塞主流程
 */

import OpenAI from 'openai';

let client = null;

function getClient() {
  if (client) return client;

  const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    console.warn('[rag.embed] No embedding API key configured (EMBEDDING_API_KEY or OPENAI_API_KEY)');
    return null;
  }

  client = new OpenAI({ apiKey, baseURL });
  console.log(`[rag.embed] Using embedding endpoint: ${baseURL}`);
  return client;
}

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

/**
 * L2 归一化
 */
function l2Normalize(vec) {
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (mag === 0) return vec;
  return vec.map((v) => v / mag);
}

/**
 * 批量文本嵌入
 * @param {string[]} texts
 * @returns {Promise<number[][]|null>} 向量数组，失败返回 null
 */
export async function embed(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const c = getClient();
  if (!c) return null;

  try {
    const resp = await c.embeddings.create({
      model: DEFAULT_MODEL,
      input: texts,
    });

    const vectors = resp.data
      .sort((a, b) => a.index - b.index)
      .map((d) => l2Normalize(d.embedding));

    return vectors;
  } catch (e) {
    console.warn(`[rag.embed] API error: ${e.message}`);
    return null;
  }
}

/**
 * 单条文本嵌入
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function embedOne(text) {
  const results = await embed([text]);
  if (!results || results.length === 0) return null;
  return results[0];
}

/**
 * 分批嵌入，每批 batchSize 条
 * @param {string[]} texts
 * @param {number} batchSize
 * @returns {Promise<(number[]|null)[]>} 与 texts 等长的数组，失败的位置为 null
 */
export async function batchEmbed(texts, batchSize = 20) {
  const results = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await embed(batch);

    if (vectors) {
      results.push(...vectors);
    } else {
      // 该批次全部失败，用 null 占位保持数组对齐
      for (let j = 0; j < batch.length; j++) results.push(null);
    }

    // 批次间稍作延迟，避免触发速率限制
    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}
