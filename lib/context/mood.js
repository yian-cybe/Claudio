import { getDb } from '../db.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MOOD_NOTES_PATH = resolve('prompts/mood-notes.json');

let moodMigrated = false;

async function migrateMoodIfNeeded() {
  if (moodMigrated) return;
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migrated_mood'").get();
  if (flag) { moodMigrated = true; return; }

  try {
    const raw = await readFile(MOOD_NOTES_PATH, 'utf8');
    const notes = JSON.parse(raw);
    if (Array.isArray(notes) && notes.length > 0) {
      const insert = db.prepare(
        'INSERT INTO mood_notes (mood, note, created_at) VALUES (?, ?, ?)'
      );
      db.exec('BEGIN');
      try {
        for (const n of notes) {
          insert.run(
            n.mood || '',
            n.note || '',
            (n.date ? new Date(n.date).toISOString() : new Date().toISOString())
          );
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      console.log(`[mood] migrated ${notes.length} notes from mood-notes.json`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[mood] migration skipped:', e.message);
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_mood', '1')").run();
  moodMigrated = true;
}

/** 添加一条心情记录 */
export async function addMoodNote({ mood, note }) {
  await migrateMoodIfNeeded();
  const db = getDb();
  db.prepare('INSERT INTO mood_notes (mood, note) VALUES (?, ?)').run(mood || '', note || '');
  return getMoodNotes();
}

/** 获取所有心情记录（按时间倒序） */
export async function getMoodNotes(limit = 100) {
  await migrateMoodIfNeeded();
  const db = getDb();
  return db.prepare('SELECT * FROM mood_notes ORDER BY id DESC LIMIT ?').all(limit);
}

/** 清空心情记录 */
export async function clearMoodNotes() {
  await migrateMoodIfNeeded();
  const db = getDb();
  db.prepare('DELETE FROM mood_notes').run();
  return [];
}
