/**
 * 品味文件写入器
 *
 * 输入：analyzer 输出的品味摘要
 * 写入：
 *   - prompts/taste.md   — 覆盖风格/歌手/讨厌类型，保留用户手动添加的注释
 *   - prompts/playlists.json — 追加新的歌单条目（去重）
 *   - 不覆盖 routines.md 和 mood-notes.json
 * 写入前备份到 state/backups/
 */

import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const TASTE_PATH = resolve('prompts/taste.md');
const PLAYLISTS_PATH = resolve('prompts/playlists.json');
const BACKUP_DIR = resolve('state/backups');

// ───────────────── 工具函数 ─────────────────

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 确保备份目录存在 */
async function ensureBackupDir() {
  await mkdir(BACKUP_DIR, { recursive: true });
}

/** 备份文件到 state/backups/filename.ts.ext */
async function backupIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  const name = filePath.replace(/[/\\:]/g, '_');
  const backupPath = resolve(BACKUP_DIR, `${timestamp()}.${name.replace(/^_+/, '')}`);
  await copyFile(filePath, backupPath);
  return backupPath;
}

// ───────────────── taste.md 生成 ─────────────────

/**
 * 生成新的 taste.md 内容。
 * 策略：如果已有手动注释（以 `<!-- manual -->` 或 `# 手动` 开头的块），保留并附加到末尾。
 */
function buildTasteMarkdown(summary) {
  const lines = [];
  lines.push('# 音乐品味档案');
  lines.push('');
  lines.push('> 此文件由 `npm run import-ncm` 自动生成，最后更新: ' + new Date(summary.analyzedAt).toLocaleString('zh-CN'));
  lines.push('');

  // 喜欢的风格
  lines.push('## 喜欢的风格');
  const genres = summary.topGenres || [];
  if (genres.length > 0) {
    const grouped = groupGenres(genres.map((g) => g.name));
    for (const [cat, items] of Object.entries(grouped)) {
      if (cat !== '_other') lines.push(`- ${cat}（${items.join('、')}）`);
    }
    if (grouped._other?.length) {
      lines.push(`- 其他（${grouped._other.join('、')}）`);
    }
  } else {
    lines.push('- （尚无足够数据，请手动补充）');
  }
  lines.push('');

  // 喜欢的歌手
  lines.push('## 喜欢的歌手 / 音乐人');
  const artists = summary.topArtists || [];
  if (artists.length > 0) {
    const topNames = artists.slice(0, 15).map((a) => a.name);
    lines.push(`- ${topNames.join('、')}`);
    if (artists.length > 15) {
      const restNames = artists.slice(15).map((a) => a.name);
      lines.push(`- ${restNames.join('、')}`);
    }
  } else {
    lines.push('- （尚无足够数据，请手动补充）');
  }
  lines.push('');

  // 偏好的年代
  lines.push('## 偏好的年代');
  const era = summary.era || [];
  if (era.length > 0) {
    const ranked = era.map((e, i) => `- ${e.decade}${i < 3 ? ' ★' : ''}`).join('\n');
    lines.push(ranked);
  } else {
    lines.push('- （尚无足够数据）');
  }
  lines.push('');

  // 讨厌的类型
  lines.push('## 讨厌的类型');
  const hated = summary.hatedGenres || [];
  if (hated.length > 0) {
    for (const h of hated) lines.push(`- ${h}`);
  } else {
    lines.push('- 重金属、死亡金属、核类');
    lines.push('- 喊麦、土嗨、DJ 版 remix');
    lines.push('- 过度商业化的 K-Pop 偶像团体');
    lines.push('- 歌词空洞的网络神曲');
  }
  lines.push('');

  // 聆听习惯
  lines.push('## 聆听习惯');
  lines.push('- （请手动补充你的聆听习惯）');
  lines.push('');

  // 手动注释保留区
  lines.push('<!-- CUSTOM:START -->');
  lines.push('<!-- 在下方添加你的手动补充，重新导入时此区域会保留 -->');
  lines.push('<!-- CUSTOM:END -->');

  return lines.join('\n');
}

/** 将风格标签归类到父类别 */
function groupGenres(genreNames) {
  const groups = {
    '爵士': [],
    '电子': [],
    '古典': [],
    '摇滚': [],
    '流行': [],
    '民谣': [],
    'R&B': [],
    'Hip-Hop': [],
    '世界音乐': [],
    '原声/配乐': [],
    _other: [],
  };

  const RULES = [
    { keywords: ['Jazz', '爵士', 'Cool', 'Bossa', 'Swing', 'Nu Jazz', 'Acid'], cat: '爵士' },
    { keywords: ['电子', 'Electronic', 'Ambient', 'Downtempo', 'Techno', 'House', 'Trip-Hop', 'Chillwave', 'Synth', 'Electro', 'EDM', 'IDM', 'Disco', 'Nu-Disco'], cat: '电子' },
    { keywords: ['古典', 'Classical', 'Chamber', 'Orchestral', 'Piano', 'New Age', '极简', 'Minimal', '电影配乐', '原声'], cat: '古典' },
    { keywords: ['Rock', '摇滚', 'Punk', 'Grunge', 'Metal', 'Hard', 'Progressive', 'Alternative', 'Indie Rock', 'Post-', 'Emo', 'Britpop'], cat: '摇滚' },
    { keywords: ['Pop', '流行', 'K-Pop', 'J-Pop', 'Synth-Pop', 'Dream Pop', 'Indie Pop', 'Dance', 'City Pop', 'Art Pop', 'Baroque Pop'], cat: '流行' },
    { keywords: ['Folk', '民谣', 'Singer-Songwriter', 'Indie Folk', 'Country', 'Acoustic', '唱作人'], cat: '民谣' },
    { keywords: ['R&B', 'Soul', 'Neo-Soul', 'Funk', 'Groove', 'Alt R&B'], cat: 'R&B' },
    { keywords: ['Hip-Hop', 'Rap', 'Trap', 'Instrumental Hip-Hop', 'Conscious'], cat: 'Hip-Hop' },
    { keywords: ['World', '世界', '民谣', 'Folk', 'Kora', '冲绳', 'Reggae', 'Latin'], cat: '世界音乐' },
    { keywords: ['Anime', '电影配乐', 'OST', 'Score', 'Soundtrack'], cat: '原声/配乐' },
  ];

  for (const name of genreNames) {
    let matched = false;
    for (const rule of RULES) {
      if (rule.keywords.some((kw) => name.includes(kw))) {
        groups[rule.cat].push(name);
        matched = true;
        break;
      }
    }
    if (!matched) groups._other.push(name);
  }

  // 移除空分类
  const result = {};
  for (const [cat, items] of Object.entries(groups)) {
    if (items.length > 0 || cat === '_other') result[cat] = items;
  }
  return result;
}

// ───────────────── playlists.json 生成 ─────────────────

/**
 * 合并新旧歌单：按 id 去重，保留旧条目的手动编辑。
 */
async function buildPlaylistsJson(newPlaylists) {
  let existing = [];
  try {
    const raw = await readFile(PLAYLISTS_PATH, 'utf8');
    existing = JSON.parse(raw);
    if (!Array.isArray(existing)) existing = [];
  } catch { /* 文件不存在或格式损坏，从零开始 */ }

  const existingIds = new Set(existing.map((p) => p.id));
  const merged = [...existing];

  for (const p of newPlaylists) {
    if (existingIds.has(p.id)) continue;
    existingIds.add(p.id);

    // 推断 mood 标签
    const mood = inferMood(p.tags || [], p.name);
    merged.push({
      name: p.name,
      description: p.description || `${p.trackCount || 0} 首歌曲的网易云歌单`,
      mood,
      tags: p.tags || [],
      _source: 'ncm-import',
    });
  }

  return merged;
}

function inferMood(tags, name) {
  const combined = [...tags, name].join(' ').toLowerCase();
  if (/早晨|清晨|早上|morning|唤醒|起床/i.test(combined)) return '清新';
  if (/专注|工作|学习|work|study|focus|安静/i.test(combined)) return '专注';
  if (/放松|chill|relax|午后|下午|休息/i.test(combined)) return '放松';
  if (/运动|跑步|健身|workout|exercise/i.test(combined)) return '活力';
  if (/夜晚|睡前|睡眠|sleep|night|安静/i.test(combined)) return '静谧';
  if (/开心|快乐|happy|party|派对/i.test(combined)) return '愉悦';
  if (/伤感|悲伤|sad|emo|忧郁/i.test(combined)) return '忧郁';
  if (/温暖|治愈|暖|治愈/i.test(combined)) return '温暖';
  return '其他';
}

// ───────────────── 公开接口 ─────────────────

/**
 * 写入品味文件。
 *
 * @param {Object} summary - analyzer.analyze() 的输出
 * @returns {{ tasteBackup, playlistsBackup, addedPlaylists }}
 */
export async function writeTasteFiles(summary) {
  await ensureBackupDir();

  // 备份原文件
  const [tasteBackup, playlistsBackup] = await Promise.all([
    backupIfExists(TASTE_PATH),
    backupIfExists(PLAYLISTS_PATH),
  ]);

  // 生成并写入 taste.md
  const tasteContent = buildTasteMarkdown(summary);
  await writeFile(TASTE_PATH, tasteContent, 'utf8');

  // 合并并写入 playlists.json
  const mergedPlaylists = await buildPlaylistsJson(summary.playlists || []);
  await writeFile(PLAYLISTS_PATH, JSON.stringify(mergedPlaylists, null, 2), 'utf8');

  const existingCount = (mergedPlaylists.length - (summary.playlists?.length || 0));
  const addedCount = (summary.playlists?.length || 0) - existingCount;

  return {
    tasteBackup,
    playlistsBackup,
    playlistsTotal: mergedPlaylists.length,
    playlistsAdded: Math.max(0, addedCount),
  };
}

/** 仅备份，不写入（预览模式） */
export async function dryRun(summary) {
  const tasteContent = buildTasteMarkdown(summary);
  const mergedPlaylists = await buildPlaylistsJson(summary.playlists || []);

  return {
    tastePreview: tasteContent,
    playlistsPreview: mergedPlaylists,
    playlistsNew: mergedPlaylists.filter((p) => p._source === 'ncm-import'),
  };
}