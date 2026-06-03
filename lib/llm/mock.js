const SAMPLES = [
  { say: '嗯,我听见你了。', play: [], reason: 'mock: greeting', segue: '' },
  { say: '深夜电台,只放给你听。', play: ["Norah Jones - Don't Know Why"], reason: 'mock: cozy night', segue: '下一首,慢一点的。' },
  { say: '这个点儿,适合一杯热的。', play: [], reason: 'mock: small talk', segue: '' },
  { say: '收到。给你换首暖的。', play: ['周深 - 大鱼'], reason: 'mock: mood shift', segue: '' },
];

export async function ask({ userMessage, historyMessages = [] }) {
  await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
  const pick = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
  const preview = userMessage.length > 20 ? `${userMessage.slice(0, 20)}…` : userMessage;
  const histNote = historyMessages.length ? ` · 带${historyMessages.length}条历史` : '';
  return {
    ...pick,
    say: `${pick.say}(mock · 收到「${preview}」${histNote})`,
    _meta: { wallMs: 700, mock: true, historyCount: historyMessages.length },
  };
}

export async function info() {
  return {
    provider: 'mock',
    ready: true,
    detail: { note: '不调真 LLM,随机返回样例(适合验证骨架链路 / LLM 不可用时)' },
  };
}
