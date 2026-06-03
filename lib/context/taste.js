/**
 * USER 品味上下文模块
 *
 * 读取 prompts/ 目录下四份品味文件，组装为 LLM 可用的结构化上下文文本。
 * 支持缓存 + POST /api/reload 热更新。
 *
 * 文件:
 *   prompts/taste.md          - 音乐品味档案
 *   prompts/routines.md       - 日常节奏表
 *   prompts/playlists.json    - 歌单索引
 *   prompts/mood-notes.json   - 近期心情日志
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TASTE_PATH = resolve('prompts/taste.md');
const ROUTINES_PATH = resolve('prompts/routines.md');
const PLAYLISTS_PATH = resolve('prompts/playlists.json');
const MOOD_PATH = resolve('prompts/mood-notes.json');

let cached = null;
let loadedAt = null;

export function clearCache() {
  cached = null;
  loadedAt = null;
}

export function info() {
  return {
    loadedAt,
    cached: cached !== null,
    files: {
      taste: TASTE_PATH,
      routines: ROUTINES_PATH,
      playlists: PLAYLISTS_PATH,
      moodNotes: MOOD_PATH,
    },
  };
}

async function tryRead(path, label) {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn(`[taste] ${label} 文件不存在: ${path}`);
      return null;
    }
    throw e;
  }
}

function formatPlaylists(raw) {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return null;
    const lines = list.map((p) => {
      const tags = p.tags?.length ? ` [${p.tags.join(', ')}]` : '';
      return `- **${p.name}**：${p.description}（情绪: ${p.mood}）${tags}`;
    });
    return `## 歌单\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

function formatMoodNotes(raw) {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return null;
    const recent = list.slice(-3); // 最多显示最近 3 条
    const lines = recent.map((m) => {
      return `- ${m.date} | 心情: ${m.mood} | ${m.note}（想听: ${m.wanted_genre || '无偏好'}）`;
    });
    return `## 近期心情\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

/** 组装品味上下文字段 */
export async function buildFragment() {
  if (cached !== null) return cached;

  const [tasteRaw, routinesRaw, playlistsRaw, moodRaw] = await Promise.all([
    tryRead(TASTE_PATH, 'taste'),
    tryRead(ROUTINES_PATH, 'routines'),
    tryRead(PLAYLISTS_PATH, 'playlists'),
    tryRead(MOOD_PATH, 'mood-notes'),
  ]);

  const parts = [];

  if (tasteRaw) {
    // 保留 Markdown 结构，前面加章节标题
    parts.push(`# 用户音乐品味\n${tasteRaw}`);
  }
  if (routinesRaw) {
    parts.push(`# 用户日常节奏\n${routinesRaw}`);
  }
  if (playlistsRaw) {
    const formatted = formatPlaylists(playlistsRaw);
    if (formatted) parts.push(formatted);
  }
  if (moodRaw) {
    const formatted = formatMoodNotes(moodRaw);
    if (formatted) parts.push(formatted);
  }

  cached = parts.join('\n\n');
  loadedAt = Date.now();
  return cached;
}