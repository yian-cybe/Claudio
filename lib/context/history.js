import * as state from '../state.js';

const { shouldPersistMessage } = state;

const MAX_SLICES = Number(process.env.CONTEXT_HISTORY_SLICES) || 6;

export function eligible(msg) {
  if (!shouldPersistMessage(msg)) return false;
  if (msg.role === 'assistant') {
    const content = String(msg.content ?? '').trim();
    const reason = String(msg.reason ?? '');
    const source = msg.source || 'user';
    if (!content || source !== 'user') return false;
    if (reason.startsWith('(parse failed') || reason === '(empty say — fallback)') return false;
    if (reason === '(offline fallback)') return false;
    if (content === '抱歉，我刚才没想好怎么说，你再说一遍？') return false;
    return true;
  }
  if (msg.role === 'user') {
    const src = msg.source || 'user';
    return src === 'user' && !!String(msg.content ?? '').trim();
  }
  return false;
}

function toLLMRole(msg) {
  return msg.role === 'user' ? 'user' : 'assistant';
}

function toLLMContent(msg) {
  // 只传主持人念出来的正文；不要把「曾推荐播放」标签写进 LLM 历史，
  // 否则模型会模仿该格式、跳过 JSON，导致前端显示「(空)」。
  return String(msg.content ?? '').trim();
}

/** 从 state 取最近 N 轮对话,供 LLM 多轮上下文 */
export async function toLLMMessages(userId) {
  const s = await state.load(userId);
  const eligibleMsgs = s.messages.filter(eligible);
  const slice = eligibleMsgs.slice(-MAX_SLICES * 2);
  return slice.map((m) => ({ role: toLLMRole(m), content: toLLMContent(m) }));
}

export function info() {
  return { maxSlices: MAX_SLICES };
}
