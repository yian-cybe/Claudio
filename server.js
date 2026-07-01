import express from 'express';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { parse } from 'node:url';
import { ask, info, provider, switchProvider, setModel } from './lib/llm/index.js';
import * as state from './lib/state.js';
import { loadPersona, clearCache as clearPersonaCache, meta as personaMeta } from './lib/persona.js';
import * as weather from './lib/context/weather.js';
import * as memory from './lib/context/memory.js';
import * as feishu from './lib/context/feishu.js';
import * as rss from './lib/context/rss.js';
import * as taste from './lib/context/taste.js';
import * as history from './lib/context/history.js';
import { buildSystemPrompt, sceneInfo, clearSceneCache } from './lib/prompt-builder.js';
import * as scheduler from './lib/scheduler.js';
import * as ncm from './lib/music/ncm.js';
import { isUrlExpired, getLyrics, getRecommend } from './lib/music/ncm.js';
import * as upnp from './lib/music/upnp.js';
import { isDebugMode, getDebugInfo } from './lib/llm/_parse.js';
import * as router from './lib/router.js';
import * as fishTts from './lib/tts/fish.js';
import * as auth from './lib/auth.js';
import { requireAuth, requireVerified } from './lib/auth.js';
import { authenticateUser, createSession, createUser, deleteSession, normalizeEmail } from './lib/accounts.js';
import * as radio from './lib/radio.js';
import * as rag from './lib/rag/index.js';
import * as usage from './lib/usage.js';
import * as billing from './lib/billing.js';
import {
  createPaymentOrder,
  getPaymentOrder,
  getPaymentOrderByTradeNo,
  markPaymentOrderPaid,
  PRODUCTS,
} from './lib/payment-orders.js';
import * as wechatPay from './lib/payments/wechat.js';
import * as alipay from './lib/payments/alipay.js';
import * as emailVerification from './lib/email-verification.js';
import * as emailDelivery from './lib/email.js';
import { applyRateHeaders, clientIp, consume, rateLimit } from './lib/rate-limit.js';
import {
  assertProductionConfig,
  launchReadiness,
  publicRuntimeInfo,
  runtimeSettingsMutable,
} from './lib/runtime-config.js';

const PORT = Number(process.env.PORT) || 8080;
assertProductionConfig();

const app = express();
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' https: blob:; connect-src 'self' https: wss:"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.json({
  limit: '64kb',
  verify(req, _res, buffer) {
    if ([
      '/api/billing/webhook',
      '/api/payments/wechat/notify',
    ].includes(req.originalUrl)) req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

const REGISTER_IP_LIMIT = Number(process.env.REGISTER_IP_LIMIT) || 5;
const LOGIN_IP_LIMIT = Number(process.env.LOGIN_IP_LIMIT) || 20;
const LOGIN_ACCOUNT_LIMIT = Number(process.env.LOGIN_ACCOUNT_LIMIT) || 10;
const AUTH_WINDOW_MS = Number(process.env.AUTH_RATE_WINDOW_MS) || 15 * 60 * 1000;
const CHAT_ACCOUNT_LIMIT = Number(process.env.CHAT_ACCOUNT_LIMIT) || 30;
const CHAT_IP_LIMIT = Number(process.env.CHAT_IP_LIMIT) || 60;
const CHAT_WINDOW_MS = Number(process.env.CHAT_RATE_WINDOW_MS) || 60 * 1000;

const registerIpLimit = rateLimit({
  namespace: 'register-ip',
  limit: REGISTER_IP_LIMIT,
  windowMs: AUTH_WINDOW_MS,
});

const loginIpLimit = rateLimit({
  namespace: 'login-ip',
  limit: LOGIN_IP_LIMIT,
  windowMs: AUTH_WINDOW_MS,
});

function loginAccountLimit(req, res, next) {
  const result = consume({
    namespace: 'login-account',
    key: normalizeEmail(req.body?.email) || 'missing',
    limit: LOGIN_ACCOUNT_LIMIT,
    windowMs: AUTH_WINDOW_MS,
  });
  applyRateHeaders(res, result);
  if (!result.allowed) {
    return res.status(429).json({
      error: 'too many login attempts',
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
  return next();
}

function consumeChatLimit(identity, req) {
  const account = consume({
    namespace: 'chat-account',
    key: identity?.id || 'unknown',
    limit: CHAT_ACCOUNT_LIMIT,
    windowMs: CHAT_WINDOW_MS,
  });
  const ip = consume({
    namespace: 'chat-ip',
    key: clientIp(req),
    limit: CHAT_IP_LIMIT,
    windowMs: CHAT_WINDOW_MS,
  });
  return !account.allowed ? account : !ip.allowed ? ip : account;
}

function setLoginSession(res, user) {
  const session = createSession(user.id);
  res.setHeader('Set-Cookie', auth.sessionCookie(session.token, session.expiresAt));
}

async function verificationDetails(user) {
  const issued = emailVerification.issueToken(user.id);
  if (issued.alreadyVerified) return { emailVerificationRequired: false };
  const required = emailVerification.verificationRequired();
  if (process.env.NODE_ENV === 'production') {
    if (!emailDelivery.config().configured) {
      return { emailVerificationRequired: required, verificationDelivery: 'not-configured' };
    }
    try {
      await emailDelivery.sendVerificationEmail({ email: user.email, token: issued.token });
      return { emailVerificationRequired: required, verificationDelivery: 'email' };
    } catch {
      return { emailVerificationRequired: required, verificationDelivery: 'failed' };
    }
  }
  const baseURL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  return {
    emailVerificationRequired: required,
    verificationDelivery: 'development-link',
    verificationUrl: `${baseURL}/?verify=${encodeURIComponent(issued.token)}`,
  };
}

app.get('/api/auth/me', (req, res) => {
  const identity = auth.requestIdentity(req, req.query?.token);
  res.json({
    authenticated: identity?.type === 'user',
    user: identity?.user || null,
    guestAllowed: process.env.NODE_ENV !== 'production',
    emailVerificationRequired: emailVerification.verificationRequired(),
  });
});

app.post('/api/auth/register', registerIpLimit, async (req, res) => {
  try {
    const user = createUser(req.body?.email, req.body?.password);
    setLoginSession(res, user);
    res.status(201).json({ ok: true, user, ...await verificationDetails(user) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', loginIpLimit, loginAccountLimit, (req, res) => {
  const user = authenticateUser(req.body?.email, req.body?.password);
  if (!user) return res.status(401).json({ error: '邮箱或密码错误' });
  setLoginSession(res, user);
  return res.json({ ok: true, user });
});

app.post('/api/auth/logout', (req, res) => {
  const identity = auth.requestIdentity(req, req.query?.token);
  if (identity?.sessionToken) deleteSession(identity.sessionToken);
  res.setHeader('Set-Cookie', auth.clearSessionCookie());
  res.json({ ok: true });
});

app.post('/api/auth/verify-email', (req, res) => {
  try {
    const user = emailVerification.verifyToken(req.body?.token);
    return res.json({ ok: true, user });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/verification/resend', requireAuth, async (req, res) => {
  if (req.identity.type !== 'user') return res.status(400).json({ error: 'user account required' });
  try {
    const details = await verificationDetails(req.identity.user);
    if (details.verificationDelivery === 'failed') {
      return res.status(503).json({ error: 'verification email delivery failed' });
    }
    return res.json({ ok: true, ...details });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/billing/webhook', (req, res) => {
  if (!billing.enabled()) return res.status(503).json({ error: 'billing webhook not configured' });
  if (!billing.verifySignature(req.rawBody || Buffer.alloc(0), req.headers['x-claudio-signature'])) {
    return res.status(401).json({ error: 'invalid billing signature' });
  }
  try {
    return res.json(billing.applyEvent(req.body));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/payments/wechat/notify', (req, res) => {
  try {
    const valid = wechatPay.verifyCallbackSignature({
      rawBody: req.rawBody,
      timestamp: req.headers['wechatpay-timestamp'],
      nonce: req.headers['wechatpay-nonce'],
      signature: req.headers['wechatpay-signature'],
      publicKey: process.env.WECHAT_PAY_PUBLIC_KEY,
    });
    if (!valid) return res.status(401).json({ code: 'FAIL', message: 'invalid signature' });
    const transaction = wechatPay.decryptResource(req.body?.resource, process.env.WECHAT_PAY_API_V3_KEY);
    const order = getPaymentOrderByTradeNo(transaction.out_trade_no);
    if (!order) throw new Error('payment order not found');
    if (req.body?.event_type !== 'TRANSACTION.SUCCESS' || transaction.trade_state !== 'SUCCESS') {
      throw new Error('WeChat payment is not successful');
    }
    if (
      transaction.mchid !== process.env.WECHAT_PAY_MCH_ID
      || transaction.appid !== process.env.WECHAT_PAY_APP_ID
      || Number(transaction.amount?.total) !== order.amountFen
      || transaction.amount?.currency !== order.currency
    ) {
      throw new Error('WeChat payment details mismatch');
    }
    markPaymentOrderPaid({
      outTradeNo: order.outTradeNo,
      provider: 'wechat',
      providerTransactionId: transaction.transaction_id,
      paidAt: transaction.success_time,
    });
    return res.json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    return res.status(400).json({ code: 'FAIL', message: error.message });
  }
});

app.post('/api/payments/alipay/notify', (req, res) => {
  try {
    if (!alipay.verifyNotification(req.body, process.env.ALIPAY_PUBLIC_KEY)) {
      return res.status(401).type('text').send('failure');
    }
    const order = getPaymentOrderByTradeNo(req.body.out_trade_no);
    if (!order) throw new Error('payment order not found');
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(req.body.trade_status)) {
      throw new Error('Alipay payment is not successful');
    }
    if (
      req.body.app_id !== process.env.ALIPAY_APP_ID
      || (process.env.ALIPAY_SELLER_ID && req.body.seller_id !== process.env.ALIPAY_SELLER_ID)
      || req.body.total_amount !== (order.amountFen / 100).toFixed(2)
    ) {
      throw new Error('Alipay payment details mismatch');
    }
    markPaymentOrderPaid({
      outTradeNo: order.outTradeNo,
      provider: 'alipay',
      providerTransactionId: req.body.trade_no,
      paidAt: req.body.gmt_payment,
    });
    return res.type('text').send('success');
  } catch {
    return res.status(400).type('text').send('failure');
  }
});

app.use('/tts-cache', express.static(resolve('state/tts-cache')));
app.use(express.static(resolve('public')));

const httpServer = createServer(app);
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  perMessageDeflate: false,
});

const WS_PING_MS = Number(process.env.WS_PING_MS) || 10000;

function broadcast(event, identityId = null) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (identityId && client.identity?.id !== identityId) continue;
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch (e) {
        console.warn('[ws] send failed to client:', e.message);
      }
    }
  }
}

wss.on('connection', (ws, req) => {
  const { query } = parse(req.url, true);
  const identity = auth.requestIdentity(req, query.token);
  if (!identity) {
    console.warn('[ws] unauthorized connection attempt from', req.socket.remoteAddress);
    ws.send(JSON.stringify({ type: 'error', message: 'unauthorized: invalid token' }));
    ws.close(4001);
    return;
  }
  if (
    emailVerification.verificationRequired()
    && identity.type === 'user'
    && !identity.user?.emailVerified
  ) {
    ws.send(JSON.stringify({ type: 'error', message: 'email verification required' }));
    ws.close(4003);
    return;
  }
  ws.identity = identity;

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('error', (err) => console.warn('[ws] client error:', err.message));

  // 发送初始欢迎消息
  ws.send(JSON.stringify({ type: 'hello', provider: provider(), t: Date.now() }));

  ws.on('message', async (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    // 处理客户端心跳回应
    if (data.type === 'pong') {
      ws.isAlive = true;
      return;
    }

    if (data.type === 'chat' && typeof data.text === 'string' && data.text.trim()) {
      const msg = data.text.trim();
      const rate = consumeChatLimit(identity, req);
      if (!rate.allowed) {
        ws.send(JSON.stringify({
          type: 'rate-limit',
          message: 'Too many messages. Please wait before trying again.',
          retryAfterSeconds: rate.retryAfterSeconds,
        }));
        return;
      }
      if (chatBusy(identity.id)) {
        ws.send(JSON.stringify({ type: 'error', message: '正在处理中，请稍候再试' }));
        return;
      }
      runChat({
        message: msg,
        source: 'user',
        identityId: identity.id,
        plan: planForIdentity(identity),
      });
    }
  });

  console.log('[ws] connected', req.socket.remoteAddress, 'clients=', wss.clients.size);
});

const wsHeartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.warn('[ws] terminating inactive client');
      return ws.terminate();
    }
    ws.isAlive = false;
    try {
      ws.ping();
      ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    } catch (e) {
      console.warn('[ws] heartbeat send failed:', e.message);
      ws.terminate();
    }
  });
}, WS_PING_MS);

wss.on('close', () => clearInterval(wsHeartbeat));
httpServer.on('close', () => clearInterval(wsHeartbeat));

const activeChats = new Set();

function chatBusy(identityId) {
  return activeChats.has(String(identityId || 'system'));
}

function planForIdentity(identity) {
  if (identity?.type === 'user') return identity.user?.plan || 'free';
  return 'admin';
}

function quotaForIdentity(identity) {
  return usage.getDailyUsage(identity?.id || 'system', planForIdentity(identity));
}

async function collectContext(userMessage = '', identityId = null) {
  const out = { now: new Date().toLocaleString('zh-CN', { hour12: false }) };
  if (weather.enabled()) {
    try {
      out.weather = await weather.getWeather();
    } catch (e) {
      out.weatherError = e.message;
    }
  }
  if (feishu.enabled()) {
    try {
      out.schedule = await feishu.getTodayEvents();
    } catch (e) {
      out.scheduleError = e.message;
    }
  }

  // RSS 资讯（在启用的前提下抓取，失败不影响主流程）
  if (rss.enabled()) {
    try {
      out.rss = await rss.getRssItems();
    } catch (e) {
      out.rssError = e.message;
    }
  }

  // 品味上下文（总是注入，由 taste 模块内部判断文件是否存在）
  out.taste = await taste.buildFragment(identityId);

  // 仅当用户输入包含关键词时，才从记忆中搜索
  if (userMessage) {
    const matchedMem = await memory.search(userMessage, identityId);
    if (matchedMem) out.memory = matchedMem;
  }

  return out;
}

async function emitSay({ say, play = [], reason = '', segue = '', source, meta = {}, ttsUrl = null, identityId = null }) {
  await state.appendMessage({
    role: 'assistant',
    content: say,
    play,
    reason,
    segue,
    source,
  }, identityId);
  broadcast({
    type: 'say',
    text: say,
    play,
    reason,
    segue,
    source,
    ttsUrl,
    meta,
  }, identityId);
}

// 核心:HTTP /api/chat 和 scheduler 都走这条路径
async function runChat({ message, scheduledFragment, source = 'user', identityId = null, plan = 'admin' }) {
  if (chatBusy(identityId)) {
    if (source !== 'user') console.log(`[${source}] skipped, busy`);
    return { ok: false, reason: 'busy' };
  }
  activeChats.add(String(identityId || 'system'));

  const userMessage = message ?? `[${source}]`;
  const route = router.route({ message: userMessage, source, scheduledFragment });

  if (route.mode === 'skip') {
    activeChats.delete(String(identityId || 'system'));
    return { ok: false, reason: route.reason };
  }

  if (route.mode === 'llm') {
    const quota = usage.getDailyUsage(identityId || 'system', plan);
    if (!quota.allowed) {
      broadcast({ type: 'quota', usage: quota, message: 'Daily AI reply limit reached.' }, identityId);
      activeChats.delete(String(identityId || 'system'));
      return { ok: false, reason: 'quota', usage: quota };
    }
  }

  broadcast({ type: 'user-echo', text: userMessage, source }, identityId);
  broadcast({ type: 'thinking', source, route: route.mode }, identityId);

  const historyMessages = route.mode === 'llm' ? await history.toLLMMessages(identityId) : [];

  try {
    await state.appendMessage({ role: 'user', content: userMessage, source }, identityId);

    if (route.mode === 'music') {
      const say = `这首可以，给你推荐「${route.keyword}」。`;
      console.log(`[router] music-recommend → ${route.keyword} (${route.reason})`);
      await emitSay({
        say,
        play: [route.keyword],
        reason: `router:${route.reason}`,
        source,
        meta: { router: route },
        identityId,
      });
      return { ok: true };
    }

    const persona = await loadPersona();
    const ctx = await collectContext(userMessage, identityId);

    // RAG 向量检索：从用户消息中查找相关记忆
    const ragContext = await rag.ragLookup(userMessage, 3, identityId);

    // RSS 资讯片段（在天气之后、品味之前注入 system prompt）
    const rssFragment = (ctx.rss && ctx.rss.length > 0) ? rss.toPromptFragment(ctx.rss) : '';

    // 拼装实时环境片段（时间 + 天气 + 日程），不含 taste/memory，由 prompt-builder 统一管理
    const envParts = [`现在 ${ctx.now}`];
    if (ctx.weather) envParts.push(`天气 ${weather.toPromptFragment(ctx.weather)}`);
    if (ctx.schedule) envParts.push(feishu.toPromptFragment(ctx.schedule));
    const env = envParts.join('\n');

    const systemPrompt = await buildSystemPrompt({
      persona,
      taste: ctx.taste || '',
      memory: ctx.memory || '',
      rag: ragContext,
      context: env,
      scheduled: scheduledFragment || '',
      rss: rssFragment,
    });

    const result = await ask({ userMessage, systemPrompt, historyMessages });
    if (result._meta?.provider !== 'offline') {
      usage.recordUsage({
        userId: identityId || 'system',
        provider: result._meta?.provider,
        model: result._meta?.model,
        tokens: result._meta?.tokens,
      });
    }

    // 调试模式：解析失败时广播 raw 前 200 字
    if (isDebugMode()) {
      const debugInfo = getDebugInfo(result);
      if (debugInfo) {
        broadcast({ type: 'debug-parse', ...debugInfo, t: Date.now() }, identityId);
      }
    }

    if (result.memorize) {
      console.log(`[memory] auto-memorizing: ${result.memorize}`);
      await memory.append(result.memorize, identityId);
    }

    let ttsUrl = null;
    if (fishTts.enabled() && result.say) {
      try {
        ttsUrl = await fishTts.synthesizeUrl(result.say);
      } catch (e) {
        console.warn('[fish-tts]', e.message);
      }
    }

    await emitSay({
      say: result.say,
      play: result.play,
      reason: result.reason,
      segue: result.segue,
      source,
      ttsUrl,
      meta: { ...result._meta, env, scheduledFragment, historyCount: historyMessages.length, router: route },
      identityId,
    });

    return { ok: true };
  } catch (e) {
    console.error(`[chat:${source}] error:`, e.message);
    broadcast({ type: 'error', message: e.message, source }, identityId);
    return { ok: false, error: e.message };
  } finally {
    activeChats.delete(String(identityId || 'system'));
  }
}

app.post('/api/chat', requireAuth, requireVerified, async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  const rate = consumeChatLimit(req.identity, req);
  applyRateHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({
      error: 'too many messages',
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }
  if (chatBusy(req.identity.id)) return res.status(429).json({ error: 'busy, one at a time for this account' });
  if (router.route({ message, source: 'user' }).mode === 'llm') {
    const quota = quotaForIdentity(req.identity);
    if (!quota.allowed) return res.status(429).json({ error: 'daily AI reply limit reached', usage: quota });
  }
  res.json({ ok: true });
  runChat({ message, source: 'user', identityId: req.identity.id, plan: planForIdentity(req.identity) });
});

async function resolveAndPlay(keyword, segue = '', forceRefresh = false, identityId = null) {
  broadcast({ type: 'resolving', keyword }, identityId);

  // 直链过期检测：当前播放同一首歌且 URL 过期时自动刷新
  if (!forceRefresh) {
    const s = await state.load(identityId);
    if (s.nowPlaying && s.nowPlaying.keyword === keyword && isUrlExpired(s.nowPlaying.fetchedAt)) {
      console.log(`[ncm] url expired for "${keyword}", re-fetching`);
      forceRefresh = true;
    }
  }

  const song = await ncm.searchAndResolve(keyword);
  if (song.error || !song.url) {
    const errText = song.error || '无可用音源';
    broadcast({
      type: 'now-playing-failed',
      keyword,
      error: errText,
      song,
      text: `抱歉，暂时播不了「${keyword}」：${errText}`,
    });
    return;
  }
  const nowPlaying = {
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    url: song.url,
    keyword,
    fetchedAt: song.fetchedAt || Date.now(),
    startedAt: Date.now(),
    segue,
  };
  await state.setNowPlaying(nowPlaying, identityId);
  broadcast({ type: 'now-playing', song: nowPlaying, segue }, identityId);
}

app.get('/api/music/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const list = await ncm.searchOnly(q, 5);
    res.json({ q, songs: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/music/play', requireAuth, async (req, res) => {
  const keyword = String(req.query.keyword ?? '').trim();
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  const song = await ncm.searchAndResolve(keyword);
  res.json(song);
});

app.post('/api/music/refresh', requireAuth, async (req, res) => {
  const s = await state.load(req.identity.id);
  if (!s.nowPlaying?.keyword) {
    return res.status(404).json({ error: 'no song playing' });
  }
  const song = await ncm.searchAndResolve(s.nowPlaying.keyword);
  if (song.error || !song.url) {
    return res.json({ ok: false, error: song.error || '无可用音源' });
  }
  const nowPlaying = {
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    url: song.url,
    keyword: s.nowPlaying.keyword,
    fetchedAt: song.fetchedAt || Date.now(),
    startedAt: Date.now(),
    segue: s.nowPlaying.segue || '',
  };
  await state.setNowPlaying(nowPlaying, req.identity.id);
  broadcast({ type: 'now-playing', song: nowPlaying, segue: nowPlaying.segue }, req.identity.id);
  res.json({ ok: true, song: nowPlaying });
});

app.get('/api/now', requireAuth, async (req, res) => {
  const s = await state.load(req.identity.id);
  res.json({ song: s.nowPlaying });
});

// 歌词 API
app.get('/api/music/lyrics', requireAuth, async (req, res) => {
  const songId = req.query.songId;
  if (!songId) return res.status(400).json({ error: 'songId required' });
  try {
    const lyrics = await getLyrics(songId);
    res.json(lyrics);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 相似推荐 API
app.get('/api/music/recommend', requireAuth, async (req, res) => {
  const songId = req.query.songId;
  if (!songId) return res.status(400).json({ error: 'songId required' });
  try {
    const rec = await getRecommend(songId);
    res.json(rec);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── UPnP 设备缓存 ─────────────────────────
let upnpCachedDevices = [];
let upnpLastScan = 0;

app.get('/api/upnp/scan', requireAuth, async (_req, res) => {
  try {
    const devices = await upnp.scanDevices(5000);
    upnpCachedDevices = devices;
    upnpLastScan = Date.now();
    res.json({
      ok: true,
      deviceCount: devices.length,
      devices: devices.map((d) => ({
        name: d.name,
        host: d.host,
        port: d.port,
        uuid: d.uuid,
      })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/upnp/push', requireAuth, async (req, res) => {
  const { deviceUuid, audioUrl } = req.body || {};
  if (!deviceUuid || !audioUrl) {
    return res.status(400).json({ error: 'deviceUuid and audioUrl required' });
  }

  // 从缓存中查找设备
  let device = upnpCachedDevices.find((d) => d.uuid === deviceUuid);
  if (!device) {
    // 如果没有缓存，尝试扫描
    try {
      const devices = await upnp.scanDevices(3000);
      upnpCachedDevices = devices;
      upnpLastScan = Date.now();
      device = devices.find((d) => d.uuid === deviceUuid);
    } catch {}
  }

  if (!device) {
    return res.status(404).json({ ok: false, error: 'Device not found, try scanning first' });
  }

  try {
    const result = await upnp.pushToDevice(device, audioUrl);
    res.json({ ok: result.ok, detail: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/upnp/play', requireAuth, async (req, res) => {
  const { deviceUuid } = req.body || {};
  if (!deviceUuid) return res.status(400).json({ error: 'deviceUuid required' });
  const device = upnpCachedDevices.find((d) => d.uuid === deviceUuid);
  if (!device) return res.status(404).json({ ok: false, error: 'Device not found in cache, scan first' });
  try {
    const result = await upnp.play(device);
    res.json({ ok: result.ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/upnp/pause', requireAuth, async (req, res) => {
  const { deviceUuid } = req.body || {};
  if (!deviceUuid) return res.status(400).json({ error: 'deviceUuid required' });
  const device = upnpCachedDevices.find((d) => d.uuid === deviceUuid);
  if (!device) return res.status(404).json({ ok: false, error: 'Device not found in cache, scan first' });
  try {
    const result = await upnp.pause(device);
    res.json({ ok: result.ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/upnp/stop', requireAuth, async (req, res) => {
  const { deviceUuid } = req.body || {};
  if (!deviceUuid) return res.status(400).json({ error: 'deviceUuid required' });
  const device = upnpCachedDevices.find((d) => d.uuid === deviceUuid);
  if (!device) return res.status(404).json({ ok: false, error: 'Device not found in cache, scan first' });
  try {
    const result = await upnp.stop(device);
    res.json({ ok: result.ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Radio 连续播放模式 ─────────────────────
app.post('/api/radio/start', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(409).json({ error: 'shared radio is disabled in cloud production' });
  }
  const { scene } = req.body || {};
  const s = radio.start(scene || null);
  broadcast({ type: 'radio-started', scene: s.scene });

  // 立即选取第一首歌
  try {
    const track = await radio.nextTrack();
    if (track.error) {
      broadcast({ type: 'radio-track-failed', error: track.error });
      res.json({ ok: true, status: s, firstTrack: null, error: track.error });
      return;
    }
    broadcast({ type: 'radio-track', ...track });
    res.json({ ok: true, status: s, firstTrack: track });
  } catch (e) {
    res.json({ ok: true, status: s, error: e.message });
  }
});

app.post('/api/radio/stop', requireAuth, (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(409).json({ error: 'shared radio is disabled in cloud production' });
  }
  const summary = radio.stop();
  broadcast({ type: 'radio-stopped', summary });
  res.json({ ok: true, summary });
});

app.get('/api/radio/next', requireAuth, async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(409).json({ error: 'shared radio is disabled in cloud production' });
  }
  try {
    const track = await radio.nextTrack();
    if (track.error) {
      broadcast({ type: 'radio-track-failed', ...track });
      res.json({ ok: false, error: track.error });
      return;
    }
    broadcast({ type: 'radio-track', ...track });
    res.json({ ok: true, track });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/radio/status', requireAuth, (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.json({ playing: false, disabled: true, reason: 'cloud-production' });
  }
  res.json(radio.status());
});

app.get('/api/context', requireAuth, async (req, res) => {
  const ctx = await collectContext('', req.identity.id);
  res.json(ctx);
});

// ── RSS 手动刷新 ──────────────────────────
app.post('/api/rss/refresh', requireAuth, async (_req, res) => {
  if (!rss.enabled()) return res.status(400).json({ error: 'RSS not enabled' });
  try {
    const items = await rss.refreshFeeds();
    res.json({ ok: true, count: items.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 品味文件读取 API
app.get('/api/profile/read', requireAuth, async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: 'file query param required' });

  const FILE_MAP = {
    'taste': 'taste.md',
    'routines': 'routines.md',
    'playlists': 'playlists.json',
    'mood-notes': 'mood-notes.json',
  };

  const target = FILE_MAP[file];
  if (!target) {
    return res.status(400).json({ error: `unknown file '${file}', must be one of: ${Object.keys(FILE_MAP).join(', ')}` });
  }

  try {
    const content = await taste.readProfile(req.identity.id, file);
    res.json({ file, content });
  } catch (e) {
    res.status(500).json({ error: `read failed: ${e.message}` });
  }
});

// 品味文件保存 API
app.post('/api/profile/save', requireAuth, async (req, res) => {
  const { file, content } = req.body;
  if (!file || content === undefined) {
    return res.status(400).json({ error: 'file and content required' });
  }

  const FILE_MAP = {
    'taste': 'taste.md',
    'routines': 'routines.md',
    'playlists': 'playlists.json',
    'mood-notes': 'mood-notes.json',
  };

  const target = FILE_MAP[file];
  if (!target) {
    return res.status(400).json({ error: `unknown file '${file}', must be one of: ${Object.keys(FILE_MAP).join(', ')}` });
  }

  try {
    await taste.saveProfile(req.identity.id, file, String(content));
  } catch (e) {
    return res.status(500).json({ error: `write failed: ${e.message}` });
  }

  // 触发热更新
  clearPersonaCache();
  taste.clearCache();
  clearSceneCache();

  res.json({ ok: true, file, storage: 'user_settings' });
});

app.get('/api/schedule', requireAuth, (_req, res) => {
  res.json({ scheduled: scheduler.list() });
});

app.post('/api/schedule/trigger/:name', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(409).json({ error: 'shared schedules are disabled in cloud production' });
  }
  const found = scheduler.findByName(req.params.name);
  if (!found) return res.status(404).json({ error: `no schedule named '${req.params.name}'` });
  res.json({ ok: true, name: found.name, fragment: found.fragment });
  runChat({ source: `scheduled:${found.name}:manual`, scheduledFragment: found.fragment, identityId: req.identity.id });
});

app.post('/api/reload', requireAuth, async (_req, res) => {
  clearPersonaCache();
  memory.clearCache();
  taste.clearCache();
  clearSceneCache();
  if (process.env.NODE_ENV !== 'production') {
    await scheduler.start((args) => runChat(args));
  }
  res.json({
    ok: true,
    persona: personaMeta(),
    memory: memory.info(),
    taste: taste.info(),
    scheduler: scheduler.list().length,
  });
});

// ── RAG 向量记忆 API ─────────────────────

app.post('/api/rag/index', requireAuth, async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(409).json({ error: 'shared prompt indexing is disabled in cloud production' });
  }
  try {
    const results = await rag.autoIndex();
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/rag/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const results = await rag.ragLookup(q, limit, req.identity.id);
    res.json({ ok: true, query: q, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/rag/status', requireAuth, (_req, res) => {
  res.json({ ok: true, ...rag.health() });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'claudio',
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/api/health/details', requireAuth, async (_req, res) => {
  const llm = await info();
  res.json({
    ok: true,
    llm,
    scene: sceneInfo(),
    context: {
      weather: weather.info(),
      memory: memory.info(),
      feishu: feishu.info(),
      rss: rss.info(),
      taste: taste.info(),
      history: history.info(),
      persona: personaMeta(),
    },
    router: { note: '播放/点歌 xxx → 直连音乐;其余走 LLM' },
    tts: { fish: fishTts.info(), browser: true },
    auth: { required: !!process.env.API_TOKEN },
    upnp: { available: upnpCachedDevices.length > 0, deviceCount: upnpCachedDevices.length },
    scheduler: { count: scheduler.list().length, items: scheduler.list() },
    rag: rag.health(),
    wsClients: wss.clients.size,
  });
});

// ── Settings API ───────────────────────
app.get('/api/runtime', (_req, res) => {
  res.json({ ok: true, ...publicRuntimeInfo() });
});

app.get('/api/launch-readiness', requireAuth, (_req, res) => {
  res.json({ ok: true, ...launchReadiness() });
});

app.get('/api/usage', requireAuth, (req, res) => {
  res.json({ ok: true, ...quotaForIdentity(req.identity) });
});

app.get('/api/billing/status', requireAuth, (req, res) => {
  const providers = {
    wechat: wechatPay.configured(),
    alipay: alipay.configured(),
  };
  res.json({
    ok: true,
    plan: planForIdentity(req.identity),
    webhookConfigured: billing.enabled(),
    product: PRODUCTS.pro_30d,
    providers,
    checkoutAvailable: Object.values(providers).some(Boolean),
  });
});

app.post('/api/payments/checkout', requireAuth, requireVerified, async (req, res) => {
  if (req.identity.type !== 'user') {
    return res.status(400).json({ error: 'user account required' });
  }
  const providerName = req.body?.provider;
  try {
    const adapter = providerName === 'wechat'
      ? wechatPay.createNativePayment
      : providerName === 'alipay'
        ? alipay.createPrecreatePayment
        : null;
    const providerConfigured = providerName === 'wechat'
      ? wechatPay.configured()
      : providerName === 'alipay' && alipay.configured();
    if (!adapter) return res.status(400).json({ error: 'unsupported payment provider' });
    if (!providerConfigured) return res.status(503).json({ error: 'payment provider not configured' });

    const order = createPaymentOrder({ userId: req.identity.user.id, provider: providerName });
    const payment = await adapter(order);
    const qrDataUrl = await QRCode.toDataURL(payment.qrContent, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });
    return res.status(201).json({ ok: true, order, qrDataUrl });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.get('/api/payments/orders/:orderId', requireAuth, (req, res) => {
  if (req.identity.type !== 'user') {
    return res.status(400).json({ error: 'user account required' });
  }
  const order = getPaymentOrder(req.params.orderId, req.identity.user.id);
  if (!order) return res.status(404).json({ error: 'payment order not found' });
  return res.json({ ok: true, order });
});

app.get('/api/settings', requireAuth, async (_req, res) => {
  const llm = await info();
  const baseURL = llm.detail?.baseURL || '';
  const service = baseURL.includes('deepseek.com') ? 'deepseek' : llm.provider;
  res.json({
    ok: true,
    provider: llm.provider,
    service,
    baseURL,
    model: llm.model,
    available: llm.available,
    ready: llm.ready,
    offline: llm.offline,
    fallback: llm.fallback,
    lastFailure: llm.lastFailure,
    recentFailures: llm.recentFailures,
    mutable: runtimeSettingsMutable(),
  });
});

app.post('/api/settings', requireAuth, (req, res) => {
  if (!runtimeSettingsMutable()) {
    return res.status(403).json({ error: 'runtime settings are locked in production' });
  }

  const { provider: newProvider, model } = req.body || {};

  if (newProvider) {
    try {
      switchProvider(newProvider);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  if (model !== undefined) {
    setModel(model || null);
  }

  const current = provider();
  res.json({
    ok: true,
    provider: current,
    model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  });
});

app.get('/api/messages', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const before = Number(req.query.before) || Infinity;
  const s = await state.load(req.identity.id);
  let messages = state.filterDisplayMessages(s.messages);

  if (before !== Infinity) {
    messages = messages.filter((m) => (m.ts || 0) < before);
  }

  const result = messages.slice(-limit);
  res.json({
    messages: result,
    total: s.messages.length,
    hasMore: messages.length > limit,
  });
});

app.post('/api/state/prune', requireAuth, async (req, res) => {
  const { days, keep } = req.body;
  if (!days && !keep) return res.status(400).json({ error: 'days or keep required' });
  const result = await state.pruneMessages({ days, keep }, req.identity.id);
  res.json({ ok: true, ...result });
});

app.post('/api/state/clear', requireAuth, async (req, res) => {
  await state.clearMessages(req.identity.id);
  broadcast({ type: 'history-cleared', t: Date.now() }, req.identity.id);
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, async (req, res) => {
  const s = await state.load(req.identity.id);
  const display = state.filterDisplayMessages(s.messages);
  res.json({
    messageCount: s.messages.length,
    displayCount: display.length,
    last5: display.slice(-5),
    createdAt: s.createdAt,
  });
});

httpServer.listen(PORT, async () => {
  console.log(`Claudio listening on http://localhost:${PORT}`);
  console.log(`LLM provider: ${provider()}`);
  try {
    const llm = await info();
    console.log(`LLM ready: ${llm.ready}`, JSON.stringify(llm.detail));
    if (!llm.ready) console.warn(`⚠ provider 未就绪${llm.error ? ': ' + llm.error : ''} —— /api/chat 会失败`);
  } catch (e) {
    console.warn('⚠ provider info 查询失败:', e.message);
  }
  if (process.env.NODE_ENV !== 'production') {
    await scheduler.start((args) => runChat(args));
  }

  // 启动时自动索引品味文件（异步，不阻塞服务）
  rag.autoIndex().catch((e) => console.warn('[rag] startup auto-index failed:', e.message));

  // 启动时异步拉取 RSS（不阻塞服务）
  if (rss.enabled()) {
    rss.getRssItems().catch((e) => console.warn('[rss] startup fetch failed:', e.message));
  }
});
