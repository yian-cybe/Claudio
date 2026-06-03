// 共享的 JSON 解析:LLM 返回的字符串可能裸 JSON / fence 围栏 / 含前缀文字,都要兜住

const PLAY_ECHO = /^\[曾推荐播放[:：]/;

export function parseInner(raw) {
  const trimmed = String(raw ?? '').trim();

  for (const candidate of jsonCandidates(trimmed)) {
    try {
      const parsed = normalize(JSON.parse(candidate));
      if (parsed.say.trim() || parsed.play.length) return parsed;
    } catch {}
  }

  // 模型误把历史里的播放标签当正文复读
  if (PLAY_ECHO.test(trimmed)) {
    return {
      say: '',
      play: [],
      reason: '(parse failed — echoed play tag from history)',
      segue: '',
      _parseError: trimmed,
      _rawHead: trimmed.slice(0, 200),
    };
  }

  return {
    say: trimmed,
    play: [],
    reason: '(parse failed — using raw output as say)',
    segue: '',
    _parseError: trimmed || '(empty raw)',
    _rawHead: trimmed.slice(0, 200),
  };
}

/** 获取 debug 信息（仅调试模式使用） */
export function getDebugInfo(result) {
  if (!result._parseError) return null;
  return {
    reason: result.reason || '',
    rawHead: result._rawHead || String(result._parseError || '').slice(0, 200),
    hasSay: !!(result.say && result.say.trim()),
    playCount: Array.isArray(result.play) ? result.play.length : 0,
  };
}

export function isDebugMode() {
  return process.env.CLAUDIO_DEBUG === '1';
}

/** 保证有可播报正文；空 say 时用 reason 或兜底句 */
export function ensureSay(result) {
  const say = String(result?.say ?? '').trim();
  if (say) return { ...result, say };

  const reason = String(result?.reason ?? '').trim();
  if (reason && !reason.startsWith('(parse failed')) {
    return { ...result, say: reason.slice(0, 120) };
  }

  return {
    ...result,
    say: '抱歉，我刚才没想好怎么说，你再说一遍？',
    reason: reason || '(empty say — fallback)',
  };
}

function* jsonCandidates(raw) {
  yield raw;

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) yield fence[1];

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    yield raw.slice(firstBrace, lastBrace + 1);
  }
}

export function normalize(obj) {
  if (!obj || typeof obj !== 'object') {
    return { say: String(obj ?? ''), play: [], reason: '', segue: '', memorize: '' };
  }
  return {
    say: String(obj.say ?? ''),
    play: Array.isArray(obj.play) ? obj.play.map(String) : [],
    reason: String(obj.reason ?? ''),
    segue: String(obj.segue ?? ''),
    memorize: String(obj.memorize ?? ''),
  };
}
