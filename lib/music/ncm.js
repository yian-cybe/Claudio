// 网易云音乐封装。NCM 包是 CommonJS,ESM 里用 default import 取整个 exports 对象。
import ncm from 'NeteaseCloudMusicApi';
import * as local from './local.js';
import { getDb } from '../db.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const QUEUE_JSON_PATH = resolve('state/queue.json');

// ── 队列迁移 ──────────────────────────────────────────
let queueMigrated = false;

async function migrateQueueIfNeeded() {
  if (queueMigrated) return;
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migrated_queue'").get();
  if (flag) { queueMigrated = true; return; }

  try {
    const raw = await readFile(QUEUE_JSON_PATH, 'utf8');
    const items = JSON.parse(raw);
    if (Array.isArray(items) && items.length > 0) {
      const insert = db.prepare(
        'INSERT INTO music_queue (song_id, title, artist, url, source) VALUES (?, ?, ?, ?, ?)'
      );
      db.exec('BEGIN');
      try {
        for (const s of items) {
          insert.run(
            String(s.song_id ?? s.id ?? ''),
            s.title || '',
            s.artist || '',
            s.url || '',
            s.source || 'ncm'
          );
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      console.log(`[ncm] migrated ${items.length} items from queue.json`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[ncm] queue migration skipped:', e.message);
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_queue', '1')").run();
  queueMigrated = true;
}

// ── 播放队列 API ──────────────────────────────────────

/** 获取播放队列 */
export async function getQueue() {
  await migrateQueueIfNeeded();
  const db = getDb();
  return db.prepare('SELECT * FROM music_queue ORDER BY id').all();
}

/** 添加歌曲到队列 */
export async function addToQueue(song) {
  await migrateQueueIfNeeded();
  const db = getDb();
  db.prepare(
    'INSERT INTO music_queue (song_id, title, artist, url, source) VALUES (?, ?, ?, ?, ?)'
  ).run(
    String(song.song_id ?? song.id ?? ''),
    song.title || '',
    song.artist || '',
    song.url || '',
    song.source || 'ncm'
  );
  return getQueue();
}

/** 清空播放队列 */
export async function clearQueue() {
  await migrateQueueIfNeeded();
  const db = getDb();
  db.prepare('DELETE FROM music_queue').run();
  return [];
}

const { search, song_url_v1, song_url, lyric: lyricApi, simi_song } = ncm;
const songUrlApi = song_url_v1 || song_url;

const RETRY_DELAY_MS = 800;
const URL_TTL_MS = 20 * 60 * 1000; // 直链 20 分钟过期

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 带重试的 Promise 执行器 */
async function withRetry(fn, label, maxRetries = 1) {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < maxRetries) {
        console.warn(`[ncm] ${label} attempt ${i + 1} failed: ${e.message}, retrying in ${RETRY_DELAY_MS}ms`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

// 查歌 + 取直链。失败时自动重试 1 次；返回 { error } 时前端 graceful 跳过。
export async function searchAndResolve(keyword) {
  if (!keyword || typeof keyword !== 'string') {
    return { error: 'keyword required' };
  }

  let songs;
  try {
    const r = await withRetry(() => search({ keywords: keyword, limit: 3 }), `search("${keyword}")`);
    songs = r?.body?.result?.songs || [];
  } catch (e) {
    console.warn(`[ncm] search failed: ${e.message}, trying local fallback`);
    const localTracks = await local.getLocalTrack(keyword);
    if (localTracks?.length) {
      const t = localTracks[0];
      return {
        ...local.play(t),
        name: t.name,
        keyword,
        source: 'local',
      };
    }
    return { error: `search failed: ${e.message}`, keyword };
  }

  if (songs.length === 0) {
    const localTracks = await local.getLocalTrack(keyword);
    if (localTracks?.length) {
      const t = localTracks[0];
      return {
        ...local.play(t),
        name: t.name,
        keyword,
        source: 'local',
      };
    }
    return { error: '没搜到', keyword };
  }

  const first = songs[0];
  const songMeta = {
    id: first.id,
    name: first.name,
    artist: (first.artists || []).map((a) => a.name).join(' / '),
    album: first.album?.name || '',
    keyword,
  };

  let urlInfo;
  try {
    const r = await withRetry(
      () => songUrlApi({ id: first.id, level: 'standard', br: 999000 }),
      `song_url(${first.id})`
    );
    urlInfo = r?.body?.data?.[0];
  } catch (e) {
    return { ...songMeta, error: `song_url failed: ${e.message}` };
  }

  if (!urlInfo?.url) {
    return { ...songMeta, error: '无版权或 VIP 限制(url=null)' };
  }

  return {
    ...songMeta,
    url: urlInfo.url,
    type: urlInfo.type,
    size: urlInfo.size,
    br: urlInfo.br,
    fetchedAt: Date.now(),
  };
}

/** 检测直链是否已过期（默认 20 分钟） */
export function isUrlExpired(fetchedAt, ttlMs = URL_TTL_MS) {
  if (!fetchedAt) return true;
  return Date.now() - fetchedAt > ttlMs;
}

// 仅搜索,返回多个候选(/api/music/search 端点用)
export async function searchOnly(keyword, limit = 5) {
  if (!keyword) return [];
  try {
    const r = await withRetry(() => search({ keywords: keyword, limit }), `searchOnly("${keyword}")`);
    return (r?.body?.result?.songs || []).map((s) => ({
      id: s.id,
      name: s.name,
      artist: (s.artists || []).map((a) => a.name).join(' / '),
      album: s.album?.name || '',
    }));
  } catch (e) {
    throw new Error(`NCM search failed: ${e.message}`);
  }
}

/** 获取歌词（原文 + 翻译），含时间戳解析供前端滚动 */
export async function getLyrics(songId) {
  if (!songId) return { error: 'songId required' };
  try {
    const r = await withRetry(() => lyricApi({ id: Number(songId) }), `lyric(${songId})`);
    const body = r?.body || {};
    const lrc = body.lrc?.lyric || '';
    const tlrc = body.tlyric?.lyric || '';
    return {
      id: Number(songId),
      lyricText: cleanLyricText(lrc),
      tlyricText: cleanLyricText(tlrc),
      lines: parseTimeline(lrc),
      tlines: parseTimeline(tlrc),
    };
  } catch (e) {
    return { error: `lyric failed: ${e.message}`, id: Number(songId), lyricText: '', tlyricText: '', lines: [], tlines: [] };
  }
}

function parseTimeline(raw) {
  if (!raw) return [];
  const lines = [];
  const re = /^\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)$/;
  for (const line of raw.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const mins = parseInt(m[1], 10);
    const secs = parseInt(m[2], 10);
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
    const text = m[4].trim();
    if (!text) continue;
    lines.push({ time: mins * 60 + secs + ms / 1000, text });
  }
  return lines;
}

function cleanLyricText(raw) {
  if (!raw) return '';
  return raw
    .split('\n')
    .map((l) => l.replace(/\[\d{2}:\d{2}[.:\d]*\]/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

/** 基于歌曲获取相似推荐 */
export async function getRecommend(songId) {
  if (!songId) return { error: 'songId required', songs: [] };
  try {
    const r = await withRetry(() => simi_song({ id: Number(songId) }), `simi_song(${songId})`);
    const songs = (r?.body?.songs || []).slice(0, 10).map((s) => ({
      id: s.id,
      name: s.name,
      artist: (s.artists || (s.ar) || []).map((a) => a.name).join(' / '),
      album: s.album?.name || '',
    }));
    return { id: Number(songId), songs };
  } catch (e) {
    return { error: `recommend failed: ${e.message}`, id: Number(songId), songs: [] };
  }
}
