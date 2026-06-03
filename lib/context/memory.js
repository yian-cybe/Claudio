import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MEMORY_PATH = resolve('prompts/memory.md');

let cached = null;
let loadedAt = null;

export function clearCache() {
  cached = null;
  loadedAt = null;
}

export async function loadFragment() {
  if (cached !== null) return cached;
  try {
    const raw = await readFile(MEMORY_PATH, 'utf8');
    cached = raw.trim();
  } catch (e) {
    if (e.code === 'ENOENT') cached = '';
    else throw e;
  }
  loadedAt = Date.now();
  return cached;
}

/** 按需检索：根据关键词从记忆中提取相关行 */
export async function search(query) {
  const content = await loadFragment();
  if (!content || !query) return '';
  
  // 提取关键词（简单的空格拆分 + 过滤掉短词）
  const keywords = query.split(/[\s,，。！!？?、]+/).filter(k => k.length >= 2);
  if (keywords.length === 0) return '';

  const lines = content.split('\n');
  const matchedLines = lines.filter(line => 
    keywords.some(k => line.toLowerCase().includes(k.toLowerCase()))
  );

  if (matchedLines.length === 0) return '';
  
  // 如果匹配结果太多，只取最近的 10 条相关记忆
  const result = matchedLines.slice(-10).join('\n');
  return `（发现相关记忆）\n${result}`;
}

/** 追加或更新记忆 */
export async function append(text) {
  const current = await loadFragment();
  const now = new Date().toLocaleString('zh-CN');
  const newContent = current 
    ? `${current}\n- [${now}] ${text}`
    : `# 长期记忆\n- [${now}] ${text}`;
  
  await writeFile(MEMORY_PATH, newContent, 'utf8');
  cached = newContent;
  loadedAt = Date.now();
  return cached;
}

export function info() {
  return {
    path: 'prompts/memory.md',
    loadedAt,
    cached: cached !== null,
    note: '编辑后调用 POST /api/reload 热更新,无需重启',
  };
}
