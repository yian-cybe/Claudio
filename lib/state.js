import { getDb } from './db.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const STATE_PATH = resolve('state/state.json');

/** 调试/测试来源，不写入 state、不进入 LLM 历史 */
const DEBUG_SOURCE = /^scheduled:test(?::|$)/;

export function shouldPersistMessage(msg) {
  const src = String(msg?.source ?? '').trim();
  if (DEBUG_SOURCE.test(src)) return false;
  if (/:manual$/.test(src)) return false;
  const content = String(msg?.content ?? '').trim();
  if (msg?.role === 'user' && /^\[scheduled:test\]/i.test(content)) return false;
  return true;
}

/** 供前端展示：过滤调试条目与空 assistant */
export function filterDisplayMessages(messages) {
  return (messages || []).filter((m) => {
    if (!shouldPersistMessage(m)) return false;
    if (m.role === 'assistant' && !String(m.content ?? '').trim()) return false;
    if (m.role === 'user' && !String(m.content ?? '').trim()) return false;
    return true;
  });
}

// ── 迁移标记 ──────────────────────────────────────────
let migrated = false;

async function migrateIfNeeded() {
  if (migrated) return;
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migrated_state'").get();
  if (flag) { migrated = true; return; }

  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const allMessages = data.messages || [];

    const persistable = allMessages.filter(shouldPersistMessage);
    if (persistable.length > 0) {
      const insert = db.prepare(
        'INSERT INTO history (role, content, source, data, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      db.exec('BEGIN');
      try {
        for (const m of persistable) {
          const { role, content, source, ts, ...extra } = m;
          insert.run(
            role,
            content,
            source || 'user',
            JSON.stringify(extra),
            ts ? new Date(ts).toISOString() : new Date().toISOString()
          );
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }

    if (data.nowPlaying) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('nowPlaying', ?)")
        .run(JSON.stringify(data.nowPlaying));
    }
    if (data.createdAt) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('createdAt', ?)")
        .run(data.createdAt);
    }

    console.log(`[state] migrated ${persistable.length} messages from state.json`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[state] migration skipped:', e.message);
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_state', '1')").run();
  migrated = true;
}

// ── 公开 API ──────────────────────────────────────────

/** 加载完整状态（保持对外签名兼容） */
export async function load() {
  await migrateIfNeeded();
  const db = getDb();

  const rows = db.prepare('SELECT role, content, source, data, created_at FROM history ORDER BY id').all();
  const messages = rows.map((r) => {
    let extra = {};
    try { extra = JSON.parse(r.data || '{}'); } catch { /* ignore */ }
    return {
      role: r.role,
      content: r.content,
      source: r.source,
      ts: new Date(r.created_at + 'Z').getTime(),
      ...extra,
    };
  });

  const npRow = db.prepare("SELECT value FROM settings WHERE key = 'nowPlaying'").get();
  const caRow = db.prepare("SELECT value FROM settings WHERE key = 'createdAt'").get();

  return {
    messages,
    nowPlaying: npRow ? JSON.parse(npRow.value) : null,
    createdAt: caRow ? caRow.value : new Date().toISOString(),
  };
}

/** SQLite 即时写入，save 保留为兼容空操作 */
export async function save() {
  // no-op：SQLite 在每次写入操作时即时持久化
}

/** 追加一条消息 */
export async function appendMessage(msg) {
  await migrateIfNeeded();
  if (!shouldPersistMessage(msg)) return load();
  const db = getDb();

  const { role, content, source, ts, ...extra } = msg;
  db.prepare(
    'INSERT INTO history (role, content, source, data) VALUES (?, ?, ?, ?)'
  ).run(role, content, source || 'user', JSON.stringify(extra));

  return load();
}

/** 清空对话历史 */
export async function clearMessages() {
  await migrateIfNeeded();
  const db = getDb();
  db.prepare('DELETE FROM history').run();
  return load();
}

/** 裁剪历史：支持按天数 days 或按保留条数 keep */
export async function pruneMessages({ days, keep }) {
  await migrateIfNeeded();
  const db = getDb();
  const originalCount = db.prepare('SELECT COUNT(*) as cnt FROM history').get().cnt;

  if (days) {
    const cutoff = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM history WHERE created_at < ?').run(cutoff);
  } else if (keep) {
    const k = Number(keep);
    const total = db.prepare('SELECT COUNT(*) as cnt FROM history').get().cnt;
    if (total > k) {
      db.prepare(
        'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)'
      ).run(k);
    }
  }

  const currentCount = db.prepare('SELECT COUNT(*) as cnt FROM history').get().cnt;
  return { originalCount, currentCount };
}

/** 更新当前播放歌曲 */
export async function setNowPlaying(song) {
  await migrateIfNeeded();
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('nowPlaying', ?)")
    .run(JSON.stringify(song));
  return load();
}
