import express from 'express';
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
import { requireAuth } from './lib/auth.js';
import * as radio from './lib/radio.js';
import * as rag from './lib/rag/index.js';

const PORT = Number(process.env.PORT) || 8080;

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use('/tts-cache', express.static(resolve('state/tts-cache')));
app.use(express.static(resolve('public')));

const httpServer = createServer(app);
const wss = new WebSocketServer({
  server: httpServer,
  path: '/stream',
  perMessageDeflate: false,
});

const WS_PING_MS = Number(process.env.WS_PING_MS) || 25000;

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on('connection', (ws, req) => {
  const { query } = parse(req.url, true);
  if (!auth.verifyToken(query.token)) {
    console.warn('[ws] unauthorized connection attempt from', req.socket.remoteAddress);
    ws.send(JSON.stringify({ type: 'error', message: 'unauthorized: invalid token' }));
    ws.close(4001);
    return;
  }
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', (err) => console.warn('[ws] client error:', err.message));
  ws.send(JSON.stringify({ type: 'hello', provider: provider(), t: Date.now() }));
  console.log('[ws] connected', req.socket.remoteAddress, 'clients=', wss.clients.size);
});

const wsHeartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      console.warn('[ws] terminating stale client');
      client.terminate();
      continue;
    }
    client.isAlive = false;
    try {
      client.ping();
      client.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    } catch (e) {
      console.warn('[ws] ping failed:', e.message);
    }
  }
}, WS_PING_MS);

wss.on('close', () => clearInterval(wsHeartbeat));
httpServer.on('close', () => clearInterval(wsHeartbeat));

let chatBusy = false;

async function collectContext(userMessage = '') {
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
  out.taste = await taste.buildFragment();

  // 仅当用户输入包含关键词时，才从记忆中搜索
  if (userMessage) {
    const matchedMem = await memory.search(userMessage);
    if (matchedMem) out.memory = matchedMem;
  }

  return out;
}

async function emitSay({ say, play = [], reason = '', segue = '', source, meta = {}, ttsUrl = null }) {
  await state.appendMessage({
    role: 'assistant',
    content: say,
    play,
    reason,
    segue,
    source,
  });
  broadcast({
    type: 'say',
    text: say,
    play,
    reason,
    segue,
    source,
    ttsUrl,
    meta,
  });
  if (Array.isArray(play) && play.length > 0) {
    resolveAndPlay(play[0], segue).catch((e) => console.error('[ncm] resolve error:', e.message));
  }
}

// 核心:HTTP /api/chat 和 scheduler 都走这条路径
async function runChat({ message, scheduledFragment, source = 'user' }) {
  if (chatBusy) {
    if (source !== 'user') console.log(`[${source}] skipped, busy`);
    return { ok: false, reason: 'busy' };
  }
  chatBusy = true;

  const userMessage = message ?? `[${source}]`;
  const route = router.route({ message: userMessage, source, scheduledFragment });

  if (route.mode === 'skip') {
    chatBusy = false;
    return { ok: false, reason: route.reason };
  }

  broadcast({ type: 'user-echo', text: userMessage, source });
  broadcast({ type: 'thinking', source, route: route.mode });

  const historyMessages = route.mode === 'llm' ? await history.toLLMMessages() : [];

  try {
    await state.appendMessage({ role: 'user', content: userMessage, source });

    if (route.mode === 'music') {
      const say = `好,给你放「${route.keyword}」。`;
      console.log(`[router] music-only → ${route.keyword} (${route.reason})`);
      await emitSay({
        say,
        play: [route.keyword],
        reason: `router:${route.reason}`,
        source,
        meta: { router: route },
      });
      return { ok: true };
    }

    const persona = await loadPersona();
    const ctx = await collectContext(userMessage);

    // RAG 向量检索：从用户消息中查找相关记忆
    const ragContext = await rag.ragLookup(userMessage, 3);

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

    // 调试模式：解析失败时广播 raw 前 200 字
    if (isDebugMode()) {
      const debugInfo = getDebugInfo(result);
      if (debugInfo) {
        broadcast({ type: 'debug-parse', ...debugInfo, t: Date.now() });
      }
    }

    if (result.memorize) {
      console.log(`[memory] auto-memorizing: ${result.memorize}`);
      await memory.append(result.memorize);
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
    });

    return { ok: true };
  } catch (e) {
    console.error(`[chat:${source}] error:`, e.message);
    broadcast({ type: 'error', message: e.message, source });
    return { ok: false, error: e.message };
  } finally {
    chatBusy = false;
  }
}

app.post('/api/chat', requireAuth, async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  if (chatBusy) return res.status(429).json({ error: 'busy, one at a time for now' });
  res.json({ ok: true });
  runChat({ message, source: 'user' }); // fire-and-forget,结果走 WS
});

async function resolveAndPlay(keyword, segue = '', forceRefresh = false) {
  broadcast({ type: 'resolving', keyword });

  // 直链过期检测：当前播放同一首歌且 URL 过期时自动刷新
  if (!forceRefresh) {
    const s = await state.load();
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
  await state.setNowPlaying(nowPlaying);
  broadcast({ type: 'now-playing', song: nowPlaying, segue });
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

app.post('/api/music/refresh', requireAuth, async (_req, res) => {
  const s = await state.load();
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
  await state.setNowPlaying(nowPlaying);
  broadcast({ type: 'now-playing', song: nowPlaying, segue: nowPlaying.segue });
  res.json({ ok: true, song: nowPlaying });
});

app.get('/api/now', requireAuth, async (_req, res) => {
  const s = await state.load();
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
  const summary = radio.stop();
  broadcast({ type: 'radio-stopped', summary });
  res.json({ ok: true, summary });
});

app.get('/api/radio/next', requireAuth, async (_req, res) => {
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
  res.json(radio.status());
});

app.get('/api/context', requireAuth, async (_req, res) => {
  const ctx = await collectContext();
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

  const { readFile } = await import('node:fs/promises');
  const path = resolve(`prompts/${target}`);
  try {
    const content = await readFile(path, 'utf8');
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

  const { writeFile } = await import('node:fs/promises');
  const path = resolve(`prompts/${target}`);

  try {
    await writeFile(path, String(content), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: `write failed: ${e.message}` });
  }

  // 触发热更新
  clearPersonaCache();
  taste.clearCache();
  clearSceneCache();

  res.json({ ok: true, file, path });
});

app.get('/api/schedule', requireAuth, (_req, res) => {
  res.json({ scheduled: scheduler.list() });
});

app.post('/api/schedule/trigger/:name', requireAuth, async (req, res) => {
  const found = scheduler.findByName(req.params.name);
  if (!found) return res.status(404).json({ error: `no schedule named '${req.params.name}'` });
  res.json({ ok: true, name: found.name, fragment: found.fragment });
  runChat({ source: `scheduled:${found.name}:manual`, scheduledFragment: found.fragment });
});

app.post('/api/reload', requireAuth, async (_req, res) => {
  clearPersonaCache();
  memory.clearCache();
  taste.clearCache();
  clearSceneCache();
  await scheduler.start((args) => runChat(args));
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
    const results = await rag.ragLookup(q, limit);
    res.json({ ok: true, query: q, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/rag/status', requireAuth, (_req, res) => {
  res.json({ ok: true, ...rag.health() });
});

app.get('/api/health', requireAuth, async (_req, res) => {
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
app.post('/api/settings', requireAuth, (req, res) => {
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
  const s = await state.load();
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
  const result = await state.pruneMessages({ days, keep });
  res.json({ ok: true, ...result });
});

app.post('/api/state/clear', requireAuth, async (_req, res) => {
  await state.clearMessages();
  broadcast({ type: 'history-cleared', t: Date.now() });
  res.json({ ok: true });
});

app.get('/api/state', async (_req, res) => {
  const s = await state.load();
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
  await scheduler.start((args) => runChat(args));

  // 启动时自动索引品味文件（异步，不阻塞服务）
  rag.autoIndex().catch((e) => console.warn('[rag] startup auto-index failed:', e.message));

  // 启动时异步拉取 RSS（不阻塞服务）
  if (rss.enabled()) {
    rss.getRssItems().catch((e) => console.warn('[rss] startup fetch failed:', e.message));
  }
});
