import * as claude from './claude.js';
import * as openai from './openai.js';
import * as mock from './mock.js';
import * as ollama from './ollama.js';
import { askWithRetry } from './retry.js';
import { createAsk } from './fallback.js';
import { logPrediction } from '../logger.js';

const ADAPTERS = { claude, openai, mock, ollama };

// ── 可变状态 ──────────────────────────────────────────
let currentProvider = null;
let currentAdapter = null;
let fallback = null;
let currentModel = null; // 用户自定义 model（仅 openai 生效）

function pickProvider() {
  if (process.env.CLAUDIO_MOCK === '1') return 'mock';
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit && ADAPTERS[explicit]) return explicit;
  if (explicit === 'auto' || !explicit) {
    if (process.env.OPENAI_API_KEY) return 'openai';
    return 'claude';
  }
  throw new Error(`未知 LLM_PROVIDER: ${explicit}(支持:${Object.keys(ADAPTERS).join(' / ')} / auto)`);
}

function buildFallback(providerName) {
  const adapter = ADAPTERS[providerName];
  const fallbackEnabled = process.env.OLLAMA_FALLBACK === 'true' && providerName !== 'ollama';

  const list = [];
  if (providerName === 'mock') {
    list.push({
      name: 'mock',
      ask: (args) => adapter.ask(args),
    });
  } else {
    const maxAttempts = Number(process.env.LLM_MAX_ATTEMPTS) || 2;
    list.push({
      name: providerName,
      ask: (args) => {
        const askArgs = (currentModel && providerName === 'openai')
          ? { ...args, model: currentModel }
          : args;
        return askWithRetry((a) => adapter.ask(a), askArgs, { maxAttempts });
      },
    });
  }

  if (fallbackEnabled) {
    list.push({
      name: 'ollama',
      ask: (args) => ollama.ask(args),
    });
  }

  return createAsk(list);
}

// ── 初始化 ────────────────────────────────────────────
(function init() {
  currentProvider = pickProvider();
  currentAdapter = ADAPTERS[currentProvider];
  fallback = buildFallback(currentProvider);
})();

// ── 运行时切换 ────────────────────────────────────────

export function switchProvider(providerName) {
  const name = String(providerName).toLowerCase();
  if (!['claude', 'openai', 'mock'].includes(name)) {
    throw new Error(`不支持的 provider: ${name}，可选 claude / openai / mock`);
  }
  currentProvider = name;
  currentAdapter = ADAPTERS[name];
  fallback = buildFallback(name);
  console.log(`[llm] switched provider → ${name}`);
  return { provider: name };
}

export function setModel(modelName) {
  currentModel = modelName || null;
  if (currentProvider === 'openai') {
    fallback = buildFallback(currentProvider);
  }
  console.log(`[llm] model set → ${currentModel || '(default)'}`);
}

// ── 公开 API ──────────────────────────────────────────

export function provider() {
  return currentProvider;
}

export async function ask(args) {
  const start = Date.now();
  const result = await fallback.ask(args);
  logPrediction({
    input: args.userMessage || '',
    output: result.say || '',
    provider: result._meta?.provider || currentProvider,
    latencyMs: Date.now() - start,
  });
  return result;
}

export async function info() {
  const h = fallback.health();
  const primaryInfo = await currentAdapter.info();
  const fallbackEnabled = process.env.OLLAMA_FALLBACK === 'true' && currentProvider !== 'ollama';

  const detail = (currentModel && currentProvider === 'openai')
    ? { ...primaryInfo.detail, model: currentModel }
    : primaryInfo.detail;

  return {
    ...primaryInfo,
    detail,
    model: currentModel || primaryInfo.detail?.model || null,
    available: ['claude', 'openai', 'mock'],
    fallback: fallbackEnabled ? 'ollama' : 'none',
    ...h,
  };
}

export async function health() {
  const fallbackEnabled = process.env.OLLAMA_FALLBACK === 'true' && currentProvider !== 'ollama';
  const fh = fallback.health();
  return {
    provider: currentProvider,
    model: currentModel || null,
    available: ['claude', 'openai', 'mock'],
    fallbackEnabled,
    ...fh,
  };
}
