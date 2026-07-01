/**
 * LLM 降级编排器 — 离线降级核心
 *
 * createAsk() 工厂函数：接收 provider 列表，依次尝试。
 * 第一个失败时自动切换下一个，全部失败返回离线兜底消息。
 */

const OFFLINE_MESSAGES = [
  { say: '现在信号不太好，我先用本地模式陪你。想听什么？', play: [], reason: '(offline fallback)' },
  { say: '网络好像断了一下，不过没关系，我还在。', play: [], reason: '(offline fallback)' },
  { say: '暂时连不上云端，但我们还可以聊聊。', play: [], reason: '(offline fallback)' },
  { say: '离线中…不过基础功能都正常，你说。', play: [], reason: '(offline fallback)' },
];

let msgIndex = 0;

function getOfflineMessage() {
  const msg = OFFLINE_MESSAGES[msgIndex % OFFLINE_MESSAGES.length];
  msgIndex++;
  return {
    ...msg,
    _meta: { wallMs: 0, provider: 'offline', offline: true },
  };
}

/**
 * 判断 provider 结果是否需要降级（失败标准）
 */
function isFailure(result) {
  if (!result) return true;
  const say = String(result.say ?? '').trim();
  if (!say) return true;
  if (result._parseError && !say) return true;
  return false;
}

/**
 * @param {Array<{ name: string, ask: Function }>} providers
 * @returns {{ ask: Function, state: Function, health: Function }}
 */
export function createAsk(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('createAsk() requires at least one provider');
  }

  const state = {
    currentProvider: providers[0].name,
    failures: [],
    lastFailure: null,
    lastSuccess: null,
  };

  return {
    async ask(args) {
      for (const provider of providers) {
        const startMs = Date.now();
        try {
          const result = await provider.ask(args);
          if (isFailure(result)) {
            throw new Error(`空响应: say="${String(result?.say ?? '').slice(0, 40)}"`);
          }

          // 成功
          state.currentProvider = provider.name;
          state.lastSuccess = Date.now();
          return {
            ...result,
            _meta: {
              ...result._meta,
              provider: provider.name,
              fallbackAttempted: provider !== providers[0],
            },
          };
        } catch (e) {
          const wallMs = Date.now() - startMs;
          const entry = {
            provider: provider.name,
            error: e.message,
            wallMs,
            at: new Date().toISOString(),
          };
          state.failures.push(entry);
          state.lastFailure = entry;
          console.warn(`[fallback] ${provider.name} failed (${wallMs}ms): ${e.message}`);
        }
      }

      // 全部失败 → 离线兜底
      console.warn('[fallback] all providers exhausted, returning offline message');
      const offline = getOfflineMessage();
      return {
        ...offline,
        _meta: {
          ...offline._meta,
          failures: state.failures.slice(-providers.length),
        },
      };
    },

    state() {
      return { ...state };
    },

    health() {
      return {
        currentProvider: state.currentProvider,
        totalFailures: state.failures.length,
        lastFailure: state.lastFailure ? state.lastFailure.error : null,
        recentFailures: state.failures.slice(-5),
        lastSuccess: state.lastSuccess,
        offline: state.failures.length > 0 && !state.lastSuccess,
      };
    },
  };
}
