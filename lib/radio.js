/**
 * Radio 引擎 — 连续播放模式
 *
 * 开启后自动按场景/心情编排歌曲，一首播完自动切下一首。
 *
 * 选歌策略：
 *   1. 根据当前时段匹配 routines → 找到对应歌单
 *   2. 构建精简选歌 prompt → 调 LLM 选歌
 *   3. 网易云搜索解析 → 播放
 *   4. 失败 → 降级本地 mp3
 *   5. 维护最近 5 首，避免重复
 */

import { getCurrentScene, buildRadioPrompt } from './prompt-builder.js';
import { ask } from './llm/index.js';
import * as ncm from './music/ncm.js';
import * as local from './music/local.js';

const MAX_RECENT = 5;

/** @type {RadioState} */
let state = null;

/**
 * @typedef {Object} RadioState
 * @property {boolean}  active
 * @property {string}   [scene]      - 用户手动指定的场景名
 * @property {string}   [currentTrack] - 当前播放歌曲名（"艺人 - 歌名"）
 * @property {number}   playedCount
 * @property {number}   startTime    - Date.now()
 * @property {string[]} recentTracks - 最近 MAX_RECENT 首（艺人 - 歌名）
 */

// ── 公开 API ──────────────────────────────────────────

export function start(scene = null) {
  state = {
    active: true,
    scene: scene || null,
    currentTrack: null,
    playedCount: 0,
    startTime: Date.now(),
    recentTracks: [],
  };
  console.log(`[radio] started${scene ? ` scene=${scene}` : ''}`);
  return status();
}

export function stop() {
  if (!state) return { active: false, note: 'was not running' };
  const summary = { ...status(), stoppedAt: Date.now() };
  state = null;
  console.log('[radio] stopped');
  return summary;
}

export function status() {
  if (!state) return { active: false };
  return {
    active: state.active,
    scene: state.scene,
    currentTrack: state.currentTrack,
    playedCount: state.playedCount,
    startTime: state.startTime,
    recentTracks: [...state.recentTracks],
  };
}

/**
 * 获取下一首歌。
 * 返回 { title, artist, url, keyword, reason } 或 { error }。
 */
export async function nextTrack() {
  if (!state || !state.active) {
    return { error: 'Radio 未启动' };
  }

  const scene = getCurrentScene(new Date());

  // 构建选歌 prompt
  const radioPrompt = buildRadioPrompt({
    scene,
    recentTracks: state.recentTracks,
    sceneOverride: state.scene,
  });

  // 调用 LLM 选歌
  let songKeyword = '';
  let reason = '';

  try {
    const result = await ask({
      userMessage: '请挑选下一首歌',
      systemPrompt: radioPrompt,
      historyMessages: [],
    });

    // 解析 LLM 输出
    const raw = (result.say || result.raw || result.text || '').trim();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 尝试提取 JSON
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
      }
    }

    if (parsed && Array.isArray(parsed.play) && parsed.play.length > 0) {
      songKeyword = parsed.play[0];
      reason = parsed.reason || '';
    } else {
      // LLM 输出不可解析，退回默认选歌策略
      songKeyword = fallbackPick(scene);
      reason = 'LLM 解析失败，使用兜底策略';
    }
  } catch (e) {
    console.warn('[radio] LLM pick failed:', e.message);
    songKeyword = fallbackPick(scene);
    reason = `LLM 调用失败: ${e.message}`;
  }

  console.log(`[radio] picked: "${songKeyword}" — ${reason}`);

  // 搜索网易云
  const song = await ncm.searchAndResolve(songKeyword);

  if (song.error || !song.url) {
    // 降级到本地 mp3
    console.log(`[radio] NCM failed for "${songKeyword}", trying local`);
    const localTracks = await local.getLocalTrack(songKeyword);
    if (localTracks && localTracks.length > 0) {
      const t = localTracks[0];
      const localResult = local.play(t);
      if (localResult) {
        updateState(`${t.name} (local)`);
        return {
          title: t.name,
          artist: '本地曲库',
          url: localResult.url,
          keyword: songKeyword,
          reason,
          source: 'local',
          trackIndex: state.playedCount,
        };
      }
    }
    return { error: `无可用音源: ${song.error || '未找到'}`, keyword: songKeyword, reason };
  }

  const trackName = `${song.artist} - ${song.name}`;
  updateState(trackName);

  return {
    title: song.name,
    artist: song.artist,
    url: song.url,
    id: song.id,
    keyword: songKeyword,
    reason,
    source: 'ncm',
    trackIndex: state.playedCount,
  };
}

// ── 内部 ──────────────────────────────────────────────

function updateState(trackName) {
  state.currentTrack = trackName;
  state.playedCount++;
  state.recentTracks.push(trackName);
  if (state.recentTracks.length > MAX_RECENT) {
    state.recentTracks = state.recentTracks.slice(-MAX_RECENT);
  }
}

/**
 * 兜底选歌：基于当前场景的推荐风格，构造一个搜索关键词。
 */
function fallbackPick(scene) {
  const genres = scene?.routine?.genres || '';
  const firstGenre = genres.split(/[,，、]/)[0]?.trim() || '爵士';

  const defaults = {
    '早晨': 'Bossa Nova 清晨',
    '上午工作': 'Ambient 钢琴',
    '午休': '轻爵士 午餐',
    '下午工作': 'Trip-Hop 电子',
    '傍晚': 'Funk Soul',
    '晚间': 'Dream Pop',
    '睡前': 'Ambient 助眠',
    '夜间休息': 'Ambient 安静',
  };

  const routineName = scene?.routine?.name || '';
  for (const [key, val] of Object.entries(defaults)) {
    if (routineName.includes(key)) return val;
  }
  return firstGenre;
}
