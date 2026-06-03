/**
 * Prompt 组装器 — PROMPT-23
 *
 * "table × routine × 场景 × 历史 ⇒ system prompt"
 *
 * 核心能力:
 *   1. 解析 routines.md → 7 时段定义 → 按当前时间自动匹配
 *   2. 解析 mood-notes.json → 心情感知 → 语气/推荐动态调整
 *   3. 解析 playlists.json → 歌单匹配 → 结构化 Table 注入
 *   4. 组装最终 system prompt
 *
 * 组装顺序:
 *   1. persona       — 人设
 *   2. scene table   — 动态场景表 (时段 + 心情 + 歌单)
 *   3. taste         — 品味上下文 (静态档案)
 *   4. rag           — 相关记忆（向量检索）
 *   5. context       — 实时环境 (时间/天气/日程)
 *   6. memory        — 长期记忆
 *   7. scheduled     — 触发说明
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROUTINES_PATH = resolve('prompts/routines.md');
const PLAYLISTS_PATH = resolve('prompts/playlists.json');
const MOOD_PATH = resolve('prompts/mood-notes.json');

// ── 缓存 ──────────────────────────────────────────────
let routinesCache = null;
let playlistsCache = null;
let moodCache = null;
let lastSceneResult = null;
let lastSceneMinute = -1;

export function clearSceneCache() {
  routinesCache = null;
  playlistsCache = null;
  moodCache = null;
  lastSceneResult = null;
  lastSceneMinute = -1;
}

// ── 时段解析 ──────────────────────────────────────────

/**
 * 解析 routines.md，提取所有时段定义。
 * 格式: "## 时段名 (HH:MM – HH:MM)" + "状态/音乐需求/推荐风格/偏好" 字段
 */
function parseRoutines(md) {
  const slots = [];
  const sectionRe = /^## (.+?) \((\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})\)/gm;

  let match;
  const sections = [];
  while ((match = sectionRe.exec(md)) !== null) {
    sections.push({
      name: match[1].trim(),
      startRaw: match[2],
      endRaw: match[3],
      startIdx: match.index + match[0].length,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const nextIdx = i + 1 < sections.length ? sections[i + 1].startIdx - sections[i + 1].name.length : md.length;
    const body = md.slice(sec.startIdx, nextIdx).trim();

    const extract = (label) => {
      const re = new RegExp(`^- ${label}[：:]\\s*(.+)$`, 'm');
      const m = body.match(re);
      return m ? m[1].trim() : '';
    };

    const parseTime = (raw) => {
      const [h, m] = raw.split(':').map(Number);
      return h * 60 + m;
    };

    const startMin = parseTime(sec.startRaw);
    let endMin = parseTime(sec.endRaw);
    if (endMin === 0 && startMin > 0) endMin = 1440;

    slots.push({
      name: sec.name,
      start: startMin,
      end: endMin,
      status: extract('状态'),
      musicNeed: extract('音乐需求'),
      genres: extract('推荐风格'),
      preference: extract('偏好'),
    });
  }

  return slots;
}

// ── 时段匹配 ──────────────────────────────────────────

function matchRoutine(slots, now) {
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const slot of slots) {
    if (minutes >= slot.start && minutes < slot.end) return slot;
  }

  // 未匹配（深夜 0:00 到第一个时段），返回到夜间休息占位
  return {
    name: '夜间休息',
    start: 0,
    end: slots[0]?.start || 420,
    status: '夜深人静，用户大概率在休息',
    musicNeed: '无（用户可能在睡觉，除非是定时唤醒任务）',
    genres: '无需推荐',
    preference: '如果用户醒着，以极度安静为主',
  };
}

// ── 心情感知 ──────────────────────────────────────────

function getCurrentMood(moodNotes) {
  if (!Array.isArray(moodNotes) || moodNotes.length === 0) return null;

  const latest = moodNotes[moodNotes.length - 1];
  const now = Date.now();
  const moodDate = new Date(latest.date);
  const hoursAgo = Math.round((now - moodDate.getTime()) / 3600000);
  const stale = hoursAgo > 24;

  return {
    mood: latest.mood,
    note: latest.note,
    wantedGenre: latest.wanted_genre || '',
    date: latest.date,
    hoursAgo,
    stale,
  };
}

// ── 歌单匹配 ──────────────────────────────────────────

function getSuggestedPlaylist(playlists, routine, mood) {
  if (!Array.isArray(playlists) || playlists.length === 0) return null;

  const routineName = routine?.name || '';

  // 1) 场景匹配：歌单 tags 或 name 与时段名有交集
  const sceneMatch = playlists.find((p) =>
    p.tags?.some((t) => routineName.includes(t)) ||
    p.name.includes(routineName.slice(0, 2))
  );
  if (sceneMatch) return sceneMatch;

  // 2) 心情匹配
  if (mood?.mood) {
    const moodMatch = playlists.find((p) =>
      p.mood === mood.mood || p.tags?.some((t) => t.includes(mood.mood))
    );
    if (moodMatch) return moodMatch;
  }

  // 3) 风格关键词匹配
  const genreKeywords = routine?.genres?.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) || [];
  if (genreKeywords.length) {
    const genreMatch = playlists.find((p) =>
      genreKeywords.some((g) => p.tags?.some((t) => t.includes(g)))
    );
    if (genreMatch) return genreMatch;
  }

  return null;
}

// ── 语气提示 ──────────────────────────────────────────

function getMoodToneHint(mood) {
  if (!mood) return '';

  const hints = {
    '疲惫': '用户最近比较疲惫，语气温柔一些，推荐放松类音乐，话少一点',
    '平静': '用户心情平静，保持沉稳温和的语气，可以推荐一些有深度的音乐',
    '愉悦': '用户心情不错，语气可以活泼一些，推荐轻快有活力的音乐',
    '焦虑': '用户可能有些焦虑，语气安抚为主，推荐舒缓放松的音乐',
    '兴奋': '用户情绪高涨，可以热情回应，推荐节奏感强的音乐',
    '低落': '用户心情不太好，语气温柔安慰为主，不要过于欢快',
  };

  const hint = hints[mood.mood] || `用户最近心情: ${mood.mood}`;
  const staleNote = mood.stale ? '（心情记录已超过 24 小时，可能已变化，仅供参考）' : '';
  return `${hint}${staleNote}`;
}

// ── 场景 Table 组装 ───────────────────────────────────

function buildSceneTable(routine, mood, playlist) {
  const lines = [];

  const pad = (v) => String(v).padStart(2, '0');
  const timeRange = `${pad(Math.floor(routine.start / 60))}:${pad(routine.start % 60)}-${pad(Math.floor(routine.end / 60))}:${pad(routine.end % 60)}`;

  lines.push('| 项目 | 详情 |');
  lines.push('|------|------|');
  lines.push(`| 当前时段 | **${routine.name}** (${timeRange}) |`);
  lines.push(`| 时段状态 | ${routine.status} |`);

  if (routine.genres) lines.push(`| 推荐风格 | ${routine.genres} |`);

  if (mood) {
    const freshness = mood.stale ? `⚠ ${mood.hoursAgo}h 前 · 可能已过期` : `${mood.hoursAgo}h 前`;
    lines.push(`| 心情状态 | **${mood.mood}**（${freshness}）${mood.stale ? '' : ' ✓'} |`);
    if (mood.note) lines.push(`| 心情备注 | ${mood.note.slice(0, 40)}${mood.note.length > 40 ? '…' : ''} |`);
    if (mood.wantedGenre) lines.push(`| 想听类型 | ${mood.wantedGenre} |`);
  }

  if (playlist) lines.push(`| 建议歌单 | **${playlist.name}** — ${playlist.description} |`);
  if (routine.preference) lines.push(`| 音量偏好 | ${routine.preference} |`);

  if (mood) {
    const toneHint = getMoodToneHint(mood);
    if (toneHint) lines.push(`| 语气建议 | ${toneHint} |`);
  }

  if (routine.musicNeed) lines.push(`| 音乐需求 | ${routine.musicNeed} |`);

  return lines.join('\n');
}

// ── Radio Prompt ───────────────────────────────────────

/**
 * 构建 Radio 模式的精简选歌 prompt。
 * 只引导 LLM 输出 { "play": ["艺人 - 歌名"], "reason": "选歌理由" }，
 * 去掉所有闲聊人设。
 *
 * @param {Object} opts
 * @param {Object} opts.scene          - getCurrentScene() 返回值
 * @param {string[]} opts.recentTracks - 最近播放列表（避免重复）
 * @param {string} [opts.sceneOverride] - 用户手动指定的场景
 * @returns {string}
 */
export function buildRadioPrompt({ scene, recentTracks = [], sceneOverride = null }) {
  const blocks = [];

  blocks.push(`你是一个音乐选曲引擎。根据当前场景信息，挑选一首最适合的歌曲。

# 输出格式（严格）
只输出一个 JSON 对象，不要 markdown 围栏，不要任何解释文字：

{
  "play": ["艺人 - 歌名"],
  "reason": "选歌理由（一句话）"
}`);

  // 场景信息
  if (scene && scene.table) {
    blocks.push(`# 当前场景
${scene.table}`);
  }

  if (sceneOverride) {
    blocks.push(`用户指定场景：${sceneOverride}`);
  }

  // 最近播放（避免重复）
  if (recentTracks.length > 0) {
    blocks.push(`# 最近播放（避免推荐以下歌曲）
${recentTracks.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
  }

  // 选歌指导
  blocks.push(`# 选歌规则
- 根据「当前场景」的推荐风格挑选一首真实的歌曲
- 不要选「最近播放」里出现过的歌
- 格式：艺人 - 歌名（例如：小野丽莎 - Fly Me To The Moon）
- 倾向选择经典曲目，不要太小众`);

  return blocks.join('\n\n');
}

// ── 公开 API ──────────────────────────────────────────

/**
 * 获取当前场景信息。同一分钟内复用缓存。
 * @param {Date|null} now
 */
export function getCurrentScene(now = null) {
  now = now || new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();

  if (lastSceneResult && lastSceneMinute === currentMinute) return lastSceneResult;

  try {
    if (!routinesCache) {
      lastSceneMinute = currentMinute;
      lastSceneResult = null;
      return null;
    }

    const routine = matchRoutine(routinesCache, now);
    const mood = getCurrentMood(moodCache);
    const playlist = getSuggestedPlaylist(playlistsCache, routine, mood);
    const table = buildSceneTable(routine, mood, playlist);

    lastSceneResult = {
      table,
      routine: { name: routine.name, start: routine.start, end: routine.end, genres: routine.genres, preference: routine.preference },
      mood: mood ? { mood: mood.mood, hoursAgo: mood.hoursAgo, stale: mood.stale } : null,
      playlist: playlist ? { name: playlist.name, description: playlist.description } : null,
    };
    lastSceneMinute = currentMinute;
    return lastSceneResult;
  } catch (e) {
    console.warn('[prompt-builder] getCurrentScene error:', e.message);
    lastSceneMinute = currentMinute;
    lastSceneResult = null;
    return null;
  }
}

// ── 文件加载 ──────────────────────────────────────────

async function tryRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function ensureSceneCache() {
  if (routinesCache && playlistsCache !== null && moodCache !== null) return;

  const [routinesRaw, playlistsRaw, moodRaw] = await Promise.all([
    tryRead(ROUTINES_PATH),
    tryRead(PLAYLISTS_PATH),
    tryRead(MOOD_PATH),
  ]);

  if (routinesRaw) routinesCache = parseRoutines(routinesRaw);
  if (playlistsRaw) {
    try { playlistsCache = JSON.parse(playlistsRaw); } catch { playlistsCache = []; }
  } else {
    playlistsCache = [];
  }
  if (moodRaw) {
    try { moodCache = JSON.parse(moodRaw); } catch { moodCache = []; }
  } else {
    moodCache = [];
  }
}

// ── 主组装函数 ────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {string}  opts.persona
 * @param {string}  [opts.taste]
 * @param {string}  [opts.memory]
 * @param {string}  [opts.rag]
 * @param {string}  [opts.context]
 * @param {string}  [opts.scheduled]
 * @param {string}  [opts.rss]
 * @param {Date}    [opts.now]
 * @returns {Promise<string>}
 */
export async function buildSystemPrompt({ persona, taste = '', memory = '', rag = '', context = '', scheduled = '', rss = '', now = null }) {
  const blocks = [];

  // 1. 人设
  blocks.push(persona);

  // 2. 动态场景 Table
  await ensureSceneCache();
  const scene = getCurrentScene(now || new Date());
  if (scene && scene.table) {
    blocks.push(`# 当前场景\n以下是根据当前时间和用户数据自动匹配的场景信息，请在推荐音乐和回复时参考：\n\n${scene.table}`);
  }

  // 3. RSS 资讯（在天气之后、品味之前注入）
  if (rss) blocks.push(`# ${rss}`);

  // 4. 品味上下文
  if (taste) blocks.push(`# 用户品味档案\n${taste}`);

  // 5. 相关记忆（向量检索）
  if (rag) blocks.push(`# 相关记忆\n${rag}`);

  // 6. 当前环境
  if (context) blocks.push(`# 当前环境\n${context}`);

  // 7. 长期记忆
  if (memory) blocks.push(`# 长期记忆\n${memory}`);

  // 8. 触发说明
  if (scheduled) blocks.push(`# 触发说明\n${scheduled}`);

  return blocks.join('\n\n');
}

// ── API 查询 ──────────────────────────────────────────

export function sceneInfo() {
  const result = getCurrentScene(new Date());
  if (!result) return { available: false, note: '未加载品味文件' };
  return {
    available: true,
    routine: result.routine,
    mood: result.mood,
    playlist: result.playlist,
  };
}