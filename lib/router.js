// 在调 LLM 前分流:纯点歌走音乐模块,定时/闲聊走 LLM

const PLAY_PREFIX = /^(?:\/play|播放|点歌|来首|放首|放一首)\s*[：:]\s*(.+)$/i;
const PLAY_INLINE = /^(?:来首|放首)\s*(.+)$/i;

export function route({ message, source, scheduledFragment }) {
  if (scheduledFragment) {
    return { mode: 'llm', reason: 'scheduled' };
  }

  const m = String(message ?? '').trim();
  if (!m) return { mode: 'skip', reason: 'empty' };

  if (source === 'user') {
    const prefixed = m.match(PLAY_PREFIX);
    if (prefixed?.[1]) {
      return { mode: 'music', keyword: prefixed[1].trim(), reason: 'play-command' };
    }
    const inline = m.match(PLAY_INLINE);
    if (inline?.[1] && inline[1].trim().length >= 2) {
      return { mode: 'music', keyword: inline[1].trim(), reason: 'play-inline' };
    }
  }

  return { mode: 'llm', reason: 'default' };
}
