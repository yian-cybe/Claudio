/**
 * Ollama 本地 LLM 适配器 — 离线降级第一层
 *
 * 调用 Ollama HTTP API，通过 prompt 引导输出 JSON（不依赖 function calling）。
 * 适用小模型（如 qwen2.5:3b），system prompt 精简为本地模型可处理的长度。
 */

import { parseInner, ensureSay } from './_parse.js';

const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const TIMEOUT_MS = 30000;

// ── 精简 system prompt（去掉复杂表格，保留核心角色 / 品味 / 上下文）──

export function buildSimpleSystemPrompt(opts = {}) {
  const { persona = '', taste = '', context = '', memory = '' } = opts;
  const blocks = [];

  // 核心角色
  if (persona) {
    // 截取 persona 的核心部分（去掉冗长的播放规则表格等，保留角色定义）
    const short = persona.length > 1800
      ? persona.slice(0, 1800) + '\n\n...（完整人设已截断，保留核心角色与品味）'
      : persona;
    blocks.push(short);
  }

  // 用户品味（精简）
  if (taste) {
    const shortTaste = taste.length > 600 ? taste.slice(0, 600) + '\n...' : taste;
    blocks.push(`# 用户品味\n${shortTaste}`);
  }

  // 当前环境
  if (context) {
    const shortCtx = context.length > 400 ? context.slice(0, 400) + '\n...' : context;
    blocks.push(`# 当前环境\n${shortCtx}`);
  }

  // 长期记忆（精简）
  if (memory) {
    const shortMem = memory.length > 500 ? memory.slice(0, 500) + '\n...' : memory;
    blocks.push(`# 记忆\n${shortMem}`);
  }

  // JSON 输出指令
  blocks.push(`# 输出格式

你必须只返回一个 JSON 对象，不要任何其他文字。格式：

{"say":"你对用户说的话（中文口语，自然温暖）","play":[],"reason":"简短说明你为什么这样说"}

- say：必须是非空的自然中文口语，像电台 DJ 一样说话
- play：暂不需要推荐歌曲时设为空数组 []
- reason：一句话说明你的回复逻辑`);

  return blocks.join('\n\n');
}

// ── HTTP 调用 ──────────────────────────────────────────

async function ollamaGenerate(model, prompt, system) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fullPrompt = system
      ? `<system>\n${system}\n</system>\n\n${prompt}`
      : prompt;

    const resp = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: 0.8,
          num_predict: 512,
        },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`Ollama API ${resp.status}: ${await resp.text().catch(() => '(no body)')}`);
    }

    const data = await resp.json();
    return String(data?.response ?? '');
  } finally {
    clearTimeout(timer);
  }
}

// ── 公开 API ──────────────────────────────────────────

export async function ask({ userMessage, systemPrompt, model = MODEL, timeoutMs = TIMEOUT_MS }) {
  const startMs = Date.now();
  const sys = systemPrompt || buildSimpleSystemPrompt();

  const raw = await ollamaGenerate(model, userMessage, sys);
  const wallMs = Date.now() - startMs;

  let inner = parseInner(raw);
  if (!inner.say?.trim() || inner._parseError) {
    console.warn('[ollama] parse issue, raw head:', raw.slice(0, 200));
  }
  inner = ensureSay(inner);

  return {
    ...inner,
    _meta: {
      wallMs,
      provider: 'ollama',
      model,
      baseURL: BASE_URL,
    },
  };
}

/**
 * 健康检查：通过 GET /api/tags 验证 Ollama 服务可达
 */
export async function info() {
  let ready = false;
  let error = null;
  let models = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(`${BASE_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      models = (data?.models || []).map((m) => m.name);
      ready = models.includes(MODEL);
      if (!ready) error = `模型 ${MODEL} 未找到，可用: ${models.join(', ') || '(无)'}`;
    } else {
      error = `GET /api/tags → ${resp.status}`;
    }
  } catch (e) {
    error = e.name === 'AbortError' ? 'Ollama 连接超时 (5s)' : e.message;
  }

  return {
    provider: 'ollama',
    model: MODEL,
    baseURL: BASE_URL,
    ready,
    error,
    detail: { models },
  };
}