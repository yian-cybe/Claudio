import { ensureSay } from './_parse.js';

/** 是否需要对 LLM 结果再请求一轮 */
export function needsRetry(result) {
  if (!result) return true;
  const say = String(result.say ?? '').trim();
  if (!say) return true;
  if (result._parseError) return true;
  const reason = String(result.reason ?? '');
  if (reason.startsWith('(parse failed')) return true;
  return false;
}

const RETRY_SUFFIX = `

【重要】你上一轮的输出无效（不是合法 JSON 或 say 为空）。
请务必只输出一个 JSON 对象，且 say 必须是至少 5 个汉字的中文口语，不要输出 [曾推荐播放] 等标签。`;

const DEFAULT_MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES) || 1;

/**
 * 包装适配器 ask：失败时自动重试，最多 maxAttempts 次（默认 1 + 1 次重试）
 */
export async function askWithRetry(adapterAsk, args, { maxAttempts = DEFAULT_MAX_RETRIES + 1 } = {}) {
  let last;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const callArgs =
      attempt === 0
        ? args
        : {
            ...args,
            systemPrompt: `${args.systemPrompt || ''}${RETRY_SUFFIX}`,
          };
    try {
      last = await adapterAsk(callArgs);
      lastError = null;
    } catch (error) {
      lastError = error;
      console.warn(`[llm] attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < maxAttempts - 1) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw error;
    }
    last = ensureSay(last);
    if (!needsRetry(last)) {
      return {
        ...last,
        _meta: { ...last._meta, attempts: attempt + 1, retried: attempt > 0 },
      };
    }
    console.warn(`[llm] attempt ${attempt + 1} invalid, say=${JSON.stringify(last.say?.slice(0, 40))}`);
    if (attempt < maxAttempts - 1) await sleep(350 * (attempt + 1));
  }
  if (lastError) throw lastError;
  return {
    ...ensureSay(last),
    _meta: { ...last._meta, attempts: maxAttempts, retried: true, exhausted: true },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
