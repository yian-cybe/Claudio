/**
 * RAG 向量存储与检索
 *
 * - 使用 SQLite (claudio.db) 新增 rag_vectors 表
 * - 余弦相似度检索（向量已 L2 归一化，直接用点积）
 * - 去重：同一 source + chunk_id 插入前删旧值
 */

import { getDb } from '../db.js';
import { embedOne, batchEmbed } from './embed.js';
import * as state from '../state.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── 建表 ──────────────────────────────────────────────

function ensureTable() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'legacy',
      source TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      content TEXT NOT NULL,
      vector TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const columns = db.prepare('PRAGMA table_info(rag_vectors)').all();
  if (!columns.some((column) => column.name === 'user_id')) {
    db.exec("ALTER TABLE rag_vectors ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy'");
  }
  db.exec('DROP INDEX IF EXISTS idx_rag_source_chunk');

  // 唯一索引：同 source + chunk_id 自动覆盖
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_user_source_chunk
    ON rag_vectors(user_id, source, chunk_id)
  `);
}

// ── 余弦相似度（L2 归一化后点积即余弦） ───────────────

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ── 工具函数 ──────────────────────────────────────────

/**
 * 从文件名推断 source 类型
 */
function sourceFromPath(filePath) {
  const basename = filePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const map = {
    taste: 'taste',
    routines: 'taste',
    playlists: 'playlists',
    'mood-notes': 'mood',
    memory: 'memory',
  };
  return map[basename] || 'taste';
}

/**
 * 文本分块：双换行分隔，单块不超过 1500 字符，超长则再切
 */
function chunkText(text) {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  const chunks = [];
  for (const para of paragraphs) {
    if (para.length <= 1500) {
      chunks.push(para);
    } else {
      // 按句子边界切分长段落
      const sentences = para.split(/(?<=[。！？.!?])\s*/);
      let current = '';
      for (const s of sentences) {
        if (current.length + s.length > 1500 && current.length > 0) {
          chunks.push(current.trim());
          current = s;
        } else {
          current += (current ? ' ' : '') + s;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }

  return chunks;
}

// ── 公开 API ──────────────────────────────────────────

/**
 * 索引最近 N 条对话历史
 * @param {number} limit - 最近 N 条消息
 * @returns {Promise<number>} 成功索引的条数
 */
export async function indexHistory(limit = 50, userId = 'legacy') {
  ensureTable();
  const db = getDb();

  const s = await state.load(userId);
  const msgs = s.messages.filter((m) => {
    if (m.role !== 'user' && m.role !== 'assistant') return false;
    return String(m.content ?? '').trim().length > 0;
  });
  const recent = msgs.slice(-limit);

  // 配对 user + assistant 作为一条记忆
  const pairs = [];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].role === 'user') {
      const userContent = String(recent[i].content ?? '').trim();
      const next = i + 1 < recent.length && recent[i + 1].role === 'assistant'
        ? String(recent[i + 1].content ?? '').trim()
        : '';
      if (userContent) {
        pairs.push({
          text: `用户: ${userContent}${next ? `\nClaudio: ${next}` : ''}`,
          ts: recent[i].ts,
        });
      }
    }
  }

  if (pairs.length === 0) return 0;

  const texts = pairs.map((p) => p.text);
  const vectors = await batchEmbed(texts);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO rag_vectors (user_id, source, chunk_id, content, vector) VALUES (?, ?, ?, ?, ?)'
  );
  const deleteOld = db.prepare('DELETE FROM rag_vectors WHERE user_id = ? AND source = ? AND chunk_id = ?');

  let count = 0;
  db.exec('BEGIN');
  try {
    for (let i = 0; i < pairs.length; i++) {
      if (!vectors[i]) continue;
      const chunkId = `hist-${pairs[i].ts || i}`;
      deleteOld.run(userId, 'history', chunkId);
      insert.run(userId, 'history', chunkId, texts[i], JSON.stringify(vectors[i]));
      count++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return count;
}

/**
 * 索引单个品味文件
 * @param {string} filePath - 相对于项目根目录的路径，如 'prompts/taste.md'
 * @returns {Promise<number>} 成功索引的分块数
 */
export async function indexPromptFile(filePath) {
  ensureTable();
  const db = getDb();

  const fullPath = resolve(filePath);
  let content;
  try {
    content = await readFile(fullPath, 'utf8');
  } catch (e) {
    console.warn(`[rag.store] Cannot read ${filePath}: ${e.message}`);
    return 0;
  }

  const source = sourceFromPath(filePath);
  const chunks = chunkText(content);

  if (chunks.length === 0) return 0;

  const vectors = await batchEmbed(chunks);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO rag_vectors (user_id, source, chunk_id, content, vector) VALUES (?, ?, ?, ?, ?)'
  );

  // 清除该文件已有的分块
  const basename = filePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  db.prepare('DELETE FROM rag_vectors WHERE user_id = ? AND source = ? AND chunk_id LIKE ?')
    .run('legacy', source, `${basename}-%`);

  let count = 0;
  db.exec('BEGIN');
  try {
    for (let i = 0; i < chunks.length; i++) {
      if (!vectors[i]) continue;
      insert.run('legacy', source, `${basename}-${i}`, chunks[i], JSON.stringify(vectors[i]));
      count++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return count;
}

/**
 * 全量索引所有数据源
 * @returns {Promise<Object>} 各数据源的索引数量
 */
export async function indexAll() {
  ensureTable();

  const results = {};

  // 品味文件
  const promptFiles = [
    'prompts/taste.md',
    'prompts/routines.md',
    'prompts/playlists.json',
    'prompts/mood-notes.json',
    'prompts/memory.md',
  ];

  for (const f of promptFiles) {
    const source = sourceFromPath(f);
    const n = await indexPromptFile(f);
    results[source] = (results[source] || 0) + n;
  }

  // 对话历史
  results.history = await indexHistory(200);

  return results;
}

/**
 * 向量相似度检索
 * @param {string} query - 查询文本
 * @param {number} topK - 返回条数
 * @param {number} threshold - 相似度阈值 (0~1)
 * @returns {Promise<Array<{content: string, source: string, score: number}>>}
 */
export async function search(query, topK = 5, threshold = 0.3, userId = 'legacy') {
  ensureTable();
  const db = getDb();

  if (!query || query.trim().length < 2) return [];

  const queryVec = await embedOne(query.trim());
  if (!queryVec) return [];

  const rows = db.prepare(
    'SELECT id, source, content, vector FROM rag_vectors WHERE user_id = ?'
  ).all(String(userId || 'legacy'));

  const scored = [];
  for (const row of rows) {
    let vec;
    try {
      vec = JSON.parse(row.vector);
    } catch {
      continue;
    }

    if (!Array.isArray(vec) || vec.length === 0) continue;

    const score = cosineSimilarity(queryVec, vec);
    if (score >= threshold) {
      scored.push({
        content: row.content,
        source: row.source,
        score: Math.round(score * 10000) / 10000,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * 清空全部索引
 */
export function clearIndex(userId = 'legacy') {
  ensureTable();
  const db = getDb();
  const info = db.prepare('DELETE FROM rag_vectors WHERE user_id = ?').run(String(userId || 'legacy'));
  return info.changes;
}
