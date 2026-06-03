/**
 * 从 state/state.json 移除调试消息（scheduled:test 等）
 * 用法: node scripts/prune-state.js
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const STATE_PATH = resolve('state/state.json');
const DEBUG_SOURCE = /^scheduled:test(?::|$)/;

function shouldKeep(msg) {
  const src = String(msg?.source ?? '').trim();
  if (DEBUG_SOURCE.test(src)) return false;
  if (msg?.role === 'user' && /^\[scheduled:test\]/i.test(String(msg.content ?? ''))) return false;
  return true;
}

const raw = await readFile(STATE_PATH, 'utf8');
const state = JSON.parse(raw);
const before = state.messages?.length ?? 0;
state.messages = (state.messages || []).filter(shouldKeep);
const after = state.messages.length;
await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
console.log(`prune-state: ${before} → ${after} (removed ${before - after})`);
