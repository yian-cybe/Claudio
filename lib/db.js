import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const DB_PATH = resolve('state/claudio.db');

/** @type {DatabaseSync | null} */
let db = null;

/**
 * 获取数据库实例（单例），首次调用自动建表并启用 WAL。
 * @returns {DatabaseSync}
 */
export function getDb() {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'user',
      data TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS music_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT,
      title TEXT,
      artist TEXT,
      url TEXT,
      source TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mood_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mood TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prediction_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input TEXT,
      output TEXT,
      provider TEXT,
      latency_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  return db;
}
