import { getDb } from './db.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const STATE_PATH = resolve('state/state.json');
const DEBUG_SOURCE = /^scheduled:test(?::|$)/;
const DEFAULT_OWNER = 'guest';
let migrated = false;

function ownerId(userId) {
  return String(userId || DEFAULT_OWNER);
}

export function shouldPersistMessage(msg) {
  const src = String(msg?.source ?? '').trim();
  if (DEBUG_SOURCE.test(src) || /:manual$/.test(src)) return false;
  const content = String(msg?.content ?? '').trim();
  if (msg?.role === 'user' && /^\[scheduled:test\]/i.test(content)) return false;
  return true;
}

export function filterDisplayMessages(messages) {
  return (messages || []).filter((message) => {
    if (!shouldPersistMessage(message)) return false;
    if ((message.role === 'assistant' || message.role === 'user') && !String(message.content ?? '').trim()) {
      return false;
    }
    return true;
  });
}

function getSetting(db, userId, key) {
  return db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
    .get(ownerId(userId), key);
}

function setSetting(db, userId, key, value) {
  db.prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)')
    .run(ownerId(userId), key, value);
}

export async function getUserSetting(userId, key, fallback = null) {
  await migrateIfNeeded();
  const row = getSetting(getDb(), userId, key);
  return row ? row.value : fallback;
}

export async function setUserSetting(userId, key, value) {
  await migrateIfNeeded();
  setSetting(getDb(), userId, key, String(value ?? ''));
  return String(value ?? '');
}

async function migrateIfNeeded() {
  if (migrated) return;
  const db = getDb();
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migrated_state'").get();
  if (flag) {
    migrated = true;
    return;
  }
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const persistable = (data.messages || []).filter(shouldPersistMessage);
    const insert = db.prepare(
      'INSERT INTO history (user_id, role, content, source, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    db.exec('BEGIN');
    try {
      for (const message of persistable) {
        const { role, content, source, ts, ...extra } = message;
        insert.run('legacy', role, content, source || 'user', JSON.stringify(extra),
          ts ? new Date(ts).toISOString() : new Date().toISOString());
      }
      if (data.nowPlaying) setSetting(db, 'legacy', 'nowPlaying', JSON.stringify(data.nowPlaying));
      if (data.createdAt) setSetting(db, 'legacy', 'createdAt', data.createdAt);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(`[state] migrated ${persistable.length} messages from state.json`);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[state] migration skipped:', error.message);
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_state', '1')").run();
  migrated = true;
}

export async function load(userId = DEFAULT_OWNER) {
  await migrateIfNeeded();
  const db = getDb();
  const owner = ownerId(userId);
  const rows = db.prepare(
    'SELECT role, content, source, data, created_at FROM history WHERE user_id = ? ORDER BY id'
  ).all(owner);
  const messages = rows.map((row) => {
    let extra = {};
    try { extra = JSON.parse(row.data || '{}'); } catch { /* ignore malformed historical data */ }
    return {
      role: row.role,
      content: row.content,
      source: row.source,
      ts: new Date(row.created_at + 'Z').getTime(),
      ...extra,
    };
  });
  const nowPlaying = getSetting(db, owner, 'nowPlaying');
  const createdAt = getSetting(db, owner, 'createdAt');
  return {
    messages,
    nowPlaying: nowPlaying ? JSON.parse(nowPlaying.value) : null,
    createdAt: createdAt ? createdAt.value : new Date().toISOString(),
  };
}

export async function save() {}

export async function appendMessage(msg, userId = DEFAULT_OWNER) {
  await migrateIfNeeded();
  if (!shouldPersistMessage(msg)) return load(userId);
  const { role, content, source, ts, ...extra } = msg;
  getDb().prepare(
    'INSERT INTO history (user_id, role, content, source, data) VALUES (?, ?, ?, ?, ?)'
  ).run(ownerId(userId), role, content, source || 'user', JSON.stringify(extra));
  return load(userId);
}

export async function clearMessages(userId = DEFAULT_OWNER) {
  await migrateIfNeeded();
  getDb().prepare('DELETE FROM history WHERE user_id = ?').run(ownerId(userId));
  return load(userId);
}

export async function pruneMessages({ days, keep }, userId = DEFAULT_OWNER) {
  await migrateIfNeeded();
  const db = getDb();
  const owner = ownerId(userId);
  const count = () => db.prepare('SELECT COUNT(*) as cnt FROM history WHERE user_id = ?').get(owner).cnt;
  const originalCount = count();
  if (days) {
    const cutoff = new Date(Date.now() - Number(days) * 86400000).toISOString();
    db.prepare('DELETE FROM history WHERE user_id = ? AND created_at < ?').run(owner, cutoff);
  } else if (keep) {
    db.prepare(`
      DELETE FROM history
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM history WHERE user_id = ? ORDER BY id DESC LIMIT ?
      )
    `).run(owner, owner, Number(keep));
  }
  return { originalCount, currentCount: count() };
}

export async function setNowPlaying(song, userId = DEFAULT_OWNER) {
  await migrateIfNeeded();
  setSetting(getDb(), userId, 'nowPlaying', JSON.stringify(song));
  return load(userId);
}
