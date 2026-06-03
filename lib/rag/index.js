/**
 * RAG 总控模块
 *
 * - 启动时自动索引品味文件（不索引 history）
 * - 提供高层检索接口 ragLookup()
 * - 健康检查
 */

import * as store from './store.js';
import { getDb } from '../db.js';

let lastIndexTime = null;

/**
 * 初始化：确保向量表存在
 */
export function initRag() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      content TEXT NOT NULL,
      vector TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_source_chunk
    ON rag_vectors(source, chunk_id)
  `);
}

/**
 * 自动索引：启动时索引品味文件（不索引 history，量太大且变化频繁）
 * @returns {Promise<Object|null>}
 */
export async function autoIndex() {
  if (process.env.RAG_ENABLED === 'false') {
    console.log('[rag] RAG disabled, skipping auto-index');
    return null;
  }

  console.log('[rag] Auto-indexing taste files...');
  try {
    initRag();

    const promptFiles = [
      'prompts/taste.md',
      'prompts/routines.md',
      'prompts/playlists.json',
      'prompts/mood-notes.json',
      'prompts/memory.md',
    ];

    const results = {};
    for (const f of promptFiles) {
      const n = await store.indexPromptFile(f);
      const key = f.replace(/^prompts[\\/]/, '').replace(/\.[^.]+$/, '');
      results[key] = n;
    }

    lastIndexTime = Date.now();
    const total = Object.values(results).reduce((s, v) => s + v, 0);
    console.log(`[rag] Auto-index done: ${total} chunks from ${Object.keys(results).length} files`);

    return results;
  } catch (e) {
    console.warn('[rag] Auto-index failed:', e.message);
    return { error: e.message };
  }
}

/**
 * 高层检索接口：返回格式化的文本片段供注入 system prompt
 * @param {string} query - 用户消息
 * @param {number} topK - 返回条数
 * @returns {Promise<string>} 格式化文本，无结果时返回空字符串
 */
export async function ragLookup(query, topK = 3) {
  if (process.env.RAG_ENABLED === 'false') return '';
  if (!query || query.trim().length < 2) return '';

  try {
    const results = await store.search(query, topK, 0.3);
    if (!results || results.length === 0) return '';

    const lines = results.map((r) => {
      // 截断过长内容，保留核心信息
      const truncated = r.content.length > 250
        ? r.content.slice(0, 250) + '…'
        : r.content;
      return `- (${r.score.toFixed(2)}) ${truncated}`;
    });

    return lines.join('\n');
  } catch (e) {
    console.warn('[rag] ragLookup error:', e.message);
    return '';
  }
}

/**
 * 健康状态
 * @returns {{ vectorCount: number, lastIndexTime: string|null, embedProvider: string, enabled: boolean }}
 */
export function health() {
  let vectorCount = 0;
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM rag_vectors').get();
    vectorCount = row?.cnt || 0;
  } catch { /* table may not exist yet */ }

  return {
    vectorCount,
    lastIndexTime: lastIndexTime ? new Date(lastIndexTime).toISOString() : null,
    embedProvider: process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || 'none',
    enabled: process.env.RAG_ENABLED !== 'false',
  };
}
