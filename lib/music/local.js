/**
 * 本地 mp3 播放 — 离线降级第二层
 *
 * 在 music/ 目录下搜索本地 mp3 文件，按文件名匹配曲目。
 * 当网易云音乐 API 不可用时作为兜底方案。
 */

import { readdir, stat } from 'node:fs/promises';
import { join, resolve, extname, basename } from 'node:path';
import { existsSync } from 'node:fs';

const MUSIC_DIR = resolve('music');

/**
 * 在 music/ 目录搜索本地 mp3，按文件名关键词匹配
 * @param {string} query - 搜索关键词（歌曲名 / 艺人名）
 * @returns {Promise<Array<{ name, path, size }>|null>}
 */
export async function getLocalTrack(query) {
  if (!query || typeof query !== 'string') return null;
  if (!existsSync(MUSIC_DIR)) return null;

  const keyword = query.toLowerCase();
  let entries;

  try {
    entries = await readdir(MUSIC_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const matches = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (ext !== '.mp3') continue;

    const nameNoExt = basename(entry.name, ext).toLowerCase();
    if (!nameNoExt.includes(keyword)) continue;

    const fullPath = join(MUSIC_DIR, entry.name);
    let size = 0;
    try {
      const s = await stat(fullPath);
      size = s.size;
    } catch { /* skip size */ }

    matches.push({
      name: basename(entry.name, ext),
      filename: entry.name,
      path: fullPath,
      size,
    });
  }

  return matches.length > 0 ? matches : null;
}

/**
 * 返回本地曲库统计
 * @returns {Promise<{ files: number, totalSize: number, tracks: Array }>}
 */
export async function info() {
  if (!existsSync(MUSIC_DIR)) {
    return { available: false, dir: MUSIC_DIR, files: 0, totalSize: 0, tracks: [] };
  }

  let entries;
  try {
    entries = await readdir(MUSIC_DIR, { withFileTypes: true });
  } catch {
    return { available: false, dir: MUSIC_DIR, files: 0, totalSize: 0, tracks: [] };
  }

  const tracks = [];
  let totalSize = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (ext !== '.mp3') continue;

    const fullPath = join(MUSIC_DIR, entry.name);
    let size = 0;
    try {
      const s = await stat(fullPath);
      size = s.size;
    } catch { /* skip */ }

    totalSize += size;
    tracks.push({
      name: basename(entry.name, ext),
      filename: entry.name,
      size,
    });
  }

  return {
    available: true,
    dir: MUSIC_DIR,
    files: tracks.length,
    totalSize,
    tracks,
  };
}

/**
 * 返回可直接播放的路径（file:// 协议供前端使用）
 * @param {{ path: string }} track
 * @returns {{ url: string, source: string }}
 */
export function play(track) {
  if (!track?.path) return null;
  // Windows: file:///D:/path/to/file.mp3
  const url = `file:///${track.path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:')}`;
  return {
    url,
    source: 'local',
    name: track.name,
  };
}