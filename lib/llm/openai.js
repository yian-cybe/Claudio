import OpenAI from 'openai';
import { parseInner, ensureSay } from './_parse.js';

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || undefined; // 默认走 openai.com
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let client = null;
function getClient() {
  if (!API_KEY) throw new Error('OPENAI_API_KEY 未设置');
  if (!client) {
    client = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
    });
  }
  return client;
}

export async function ask({ userMessage, systemPrompt, historyMessages = [], model = MODEL, timeoutMs = 30000 }) {
  const startMs = Date.now();
  const c = getClient();

  // 给 system prompt 末尾追加一句,确保走 JSON 模式时模型知道要包 JSON
  const sys = `${systemPrompt}\n\n（务必只返回 JSON 对象,不要任何其他文字。）`;

  const messages = [
    { role: 'system', content: sys },
    ...historyMessages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    { role: 'user', content: userMessage },
  ];

  const resp = await c.chat.completions.create({
    model,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.7,
  }, { timeout: timeoutMs });

  const wallMs = Date.now() - startMs;
  const raw = resp.choices?.[0]?.message?.content ?? '';
  if (!raw.trim()) {
    throw new Error(`模型返回空内容 (finishReason=${resp.choices?.[0]?.finish_reason || 'unknown'})`);
  }
  let inner = parseInner(raw);
  if (!inner.say?.trim() || inner._parseError) {
    console.warn('[openai] parse issue, raw head:', raw.slice(0, 200));
  }
  inner = ensureSay(inner);

  return {
    ...inner,
    _meta: {
      wallMs,
      model: resp.model,
      tokens: resp.usage,
      finishReason: resp.choices?.[0]?.finish_reason,
    },
  };
}

export async function info() {
  return {
    provider: 'openai',
    ready: !!API_KEY,
    detail: {
      model: MODEL,
      baseURL: BASE_URL || 'https://api.openai.com/v1 (默认)',
      hasKey: !!API_KEY,
    },
    error: API_KEY ? undefined : 'OPENAI_API_KEY 未设置',
  };
}
