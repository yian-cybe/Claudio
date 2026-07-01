import * as state from '../state.js';

const MEMORY_KEY = 'memory';

export function clearCache() {}

export async function loadFragment(userId) {
  return state.getUserSetting(userId, MEMORY_KEY, '');
}

export async function search(query, userId) {
  const content = await loadFragment(userId);
  if (!content || !query) return '';
  const keywords = String(query).split(/[\s,，。！!？?、]+/).filter((keyword) => keyword.length >= 2);
  if (!keywords.length) return '';
  const matched = content.split('\n').filter((line) =>
    keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
  );
  return matched.length ? `（发现相关记忆）\n${matched.slice(-10).join('\n')}` : '';
}

export async function append(text, userId) {
  const current = await loadFragment(userId);
  const now = new Date().toLocaleString('zh-CN');
  const next = current
    ? `${current}\n- [${now}] ${text}`
    : `# 长期记忆\n- [${now}] ${text}`;
  return state.setUserSetting(userId, MEMORY_KEY, next);
}

export function info() {
  return {
    storage: 'user_settings',
    key: MEMORY_KEY,
    note: 'Long-term memory is isolated by authenticated identity.',
  };
}
