const $ = (id) => document.getElementById(id);

// ── 元素引用 ──────────────────────────────
const $chat = $('chat');
const $input = $('input');
const $send = $('send');
const $form = $('compose');
const $wsDot = $('ws-dot');
const $wsText = $('ws-text');
const $debug = $('debug');
const $clearChat = $('clear-chat');
const $debugToggle = $('debug-toggle');
const $debugLog = $('debug-log');
const $loadMore = $('load-more');
const $emptyState = $('empty-state');
const $recentList = $('recent-list');
const $newChat = $('new-chat');
const $player = $('player');
const $playerUnlock = $('player-unlock');
const $playerCard = $('player-card');
const $playerTitle = $('player-title');
const $playerArtist = $('player-artist');
const $playerToggle = $('player-toggle');
const $playerSegue = $('player-segue');
const $playerCurrent = $('player-current');
const $playerDuration = $('player-duration');
const $playerProgress = $('player-progress');
const $playerRecommend = $('player-recommend');
const $lyricsPanel = $('lyrics-panel');
const $lyricsContent = $('lyrics-content');
const $recommendPanel = $('recommend-panel');
const $recommendList = $('recommend-list');
const $audio = $('player-audio');
// UPnP
const $playerUpnp = $('player-upnp');
const $upnpPanel = $('upnp-panel');
const $upnpDeviceList = $('upnp-device-list');
const $upnpClose = $('upnp-close');
const $upnpRescan = $('upnp-rescan');
// Radio
const $radioBar = $('radio-bar');
const $radioToggle = $('radio-toggle');
const $radioSceneTag = $('radio-scene-tag');
const $radioTrackCount = $('radio-track-count');
const $radioStopBtn = $('radio-stop-btn');

// ── Auth ──────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
let apiToken = urlParams.get('token') || localStorage.getItem('claudio-token') || '';
if (urlParams.get('token')) {
  localStorage.setItem('claudio-token', apiToken);
  const newUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, '', newUrl);
}
function getAuthHeader() { return apiToken ? { 'Authorization': `Bearer ${apiToken}` } : {}; }

// ── WebSocket ─────────────────────────
let ws = null, wsGen = 0, reconnectTimer = null, reconnectDelay = 1000;
let thinkingNode = null, resolvingNode = null;
let audioUnlocked = false, pendingSong = null, pendingSegue = null;

function log(...parts) {
  const line = parts.map((p) => typeof p === 'string' ? p : JSON.stringify(p, null, 2)).join(' ');
  $debugLog.textContent += `[${new Date().toLocaleTimeString()}] ${line}\n`;
  $debugLog.scrollTop = $debugLog.scrollHeight;
}
function setWsStatus(state, label) { $wsDot.className = `dot dot-${state}`; $wsText.textContent = label; }

// ── 消息展示 ─────────────────────────
function appendMessage(role, text, extras = {}) {
  if ($emptyState) $emptyState.classList.add('hidden');
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  if (extras.scheduled && role === 'asst') div.classList.add('scheduled');
  div.textContent = text;
  if (extras.play && extras.play.length) {
    const tags = document.createElement('div');
    tags.className = 'play-tags';
    for (const t of extras.play) {
      const tag = document.createElement('span');
      tag.className = 'play-tag'; tag.textContent = `♪ ${t}`; tags.appendChild(tag);
    }
    div.appendChild(tags);
  }
  if (extras.prepend) {
    const firstMsg = [...$chat.children].find((c) => c.classList.contains('msg'));
    if (firstMsg) { $chat.insertBefore(div, firstMsg); } else { $chat.appendChild(div); }
  } else { $chat.appendChild(div); $chat.scrollTop = $chat.scrollHeight; }
  return div;
}

function showToast(text, durationMs = 4500) {
  const toast = document.createElement('div');
  toast.className = 'toast'; toast.textContent = text;
  $chat.appendChild(toast); $chat.scrollTop = $chat.scrollHeight;
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s ease'; setTimeout(() => toast.remove(), 500); }, durationMs);
}

// ── 歌词 & 推荐 ─────────────────────────
let lyricsLines = [], lyricsTlines = [], lastLyricIdx = -1, ttsAudio = null;

async function fetchLyrics(songId) {
  if (!songId) return;
  $lyricsContent.innerHTML = '<div class="lyrics-loading">加载歌词中…</div>';
  $lyricsPanel.classList.remove('hidden');
  try {
    const r = await fetch(`/api/music/lyrics?songId=${songId}`, { headers: getAuthHeader() });
    const d = await r.json();
    if (d.error || (!d.lines.length && !d.tlines.length)) {
      $lyricsContent.innerHTML = '<div class="lyrics-empty">暂无歌词</div>';
      lyricsLines = []; lyricsTlines = []; return;
    }
    lyricsLines = d.lines || []; lyricsTlines = d.tlines || [];
    renderLyrics(lyricsLines);
  } catch (e) { $lyricsContent.innerHTML = '<div class="lyrics-empty">歌词加载失败</div>'; }
}

function renderLyrics(lines) {
  if (!lines.length) { $lyricsContent.innerHTML = '<div class="lyrics-empty">暂无歌词</div>'; return; }
  $lyricsContent.innerHTML = lines.map((l, i) => `<div class="lyric-line" data-idx="${i}">${escHtml(l.text)}</div>`).join('');
  lastLyricIdx = -1;
}

function scrollLyrics(currentTime) {
  if (!lyricsLines.length) return;
  let idx = -1;
  for (let i = 0; i < lyricsLines.length; i++) { if (lyricsLines[i].time <= currentTime) idx = i; else break; }
  if (idx === lastLyricIdx) return;
  lastLyricIdx = idx;
  const prev = $lyricsContent.querySelector('.lyric-active');
  if (prev) prev.classList.remove('lyric-active');
  if (idx >= 0) {
    const cur = $lyricsContent.querySelector(`[data-idx="${idx}"]`);
    if (cur) { cur.classList.add('lyric-active'); cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function loadRecommend(songId) {
  if ($recommendPanel.classList.contains('hidden')) {
    $recommendPanel.classList.remove('hidden');
    $recommendList.innerHTML = '<div class="lyrics-loading">加载推荐中…</div>';
    try {
      const r = await fetch(`/api/music/recommend?songId=${songId}`, { headers: getAuthHeader() });
      const d = await r.json();
      if (d.error || !d.songs?.length) { $recommendList.innerHTML = '<div class="lyrics-empty">暂无推荐</div>'; return; }
      $recommendList.innerHTML = d.songs.map((s) =>
        `<div class="recommend-item" data-kw="${escHtml(s.name + ' ' + s.artist)}">` +
        `<span class="rec-name">${escHtml(s.name)}</span><span class="rec-artist"> — ${escHtml(s.artist)}</span></div>`
      ).join('');
      $recommendList.querySelectorAll('.recommend-item').forEach((el) => {
        el.addEventListener('click', () => {
          const kw = el.dataset.kw;
          appendMessage('user', `点歌 ${kw}`);
          fetch('/api/music/play?keyword=' + encodeURIComponent(kw), { headers: getAuthHeader() })
            .then((r) => r.json()).then((song) => { if (song.url) playSong(song, ''); else showToast('抱歉，这首歌暂时无法播放'); });
        });
      });
    } catch (e) { $recommendList.innerHTML = '<div class="lyrics-empty">推荐加载失败</div>'; }
  } else { $recommendPanel.classList.add('hidden'); }
}

$playerRecommend.addEventListener('click', () => { const songId = $audio.dataset.songId; if (songId) loadRecommend(songId); });

// ── TTS ────────────────────────────────
const TTS_PREF_KEY = 'claudio-tts-enabled';
let ttsEnabled = true;

function speakBrowser(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 1.05;
  const voices = speechSynthesis.getVoices();
  const zh = voices.find((v) => v.lang?.toLowerCase().startsWith('zh'));
  if (zh) u.voice = zh;
  speechSynthesis.speak(u);
}

async function speak(text, ttsUrl) {
  if (!ttsEnabled || !text) return;
  if (ttsUrl) {
    try {
      if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
      speechSynthesis.cancel();
      ttsAudio = new Audio(ttsUrl); await ttsAudio.play();
      return;
    } catch (e) { log('fish tts play failed, fallback browser:', e.message); }
  }
  try { speakBrowser(text); } catch (e) { log('tts error:', e.message); }
}

// ── 播放器 ────────────────────────────
function showPlayerUnlock() { $player.classList.remove('hidden'); $playerUnlock.classList.remove('hidden'); $playerCard.classList.add('hidden'); }
function showPlayerCard() { $player.classList.remove('hidden'); $playerUnlock.classList.add('hidden'); $playerCard.classList.remove('hidden'); }

let currentSongUrl = null; // 当前播放歌曲的 URL，用于 UPnP 推送

async function playSong(song, segue = '') {
  if (!song?.url) return;
  currentSongUrl = song.url;
  if (!audioUnlocked) { pendingSong = song; pendingSegue = segue; showPlayerUnlock(); return; }
  $playerTitle.textContent = song.name; $playerArtist.textContent = song.artist; $playerSegue.textContent = segue || '';
  $audio.src = song.url; $audio.dataset.songId = song.id || '';
  $lyricsPanel.classList.add('hidden'); $lyricsContent.innerHTML = '';
  $recommendPanel.classList.add('hidden');
  lyricsLines = []; lyricsTlines = []; lastLyricIdx = -1;
  if (song.id) fetchLyrics(song.id);
  showPlayerCard();
  try { await $audio.play(); $playerToggle.textContent = '⏸'; } catch (e) {
    log('audio.play failed:', e.message); audioUnlocked = false; pendingSong = song; showPlayerUnlock();
  }
}

// ── UPnP/DLNA 推流 ──────────────────────
let upnpDevices = [];
let upnpScanning = false;

async function upnpScan() {
  if (upnpScanning) return;
  upnpScanning = true;
  $upnpDeviceList.innerHTML = '<div class="upnp-loading">正在扫描...</div>';
  try {
    const r = await fetch('/api/upnp/scan', { headers: getAuthHeader() });
    const d = await r.json();
    upnpDevices = d.devices || [];
    renderUpnpDevices();
  } catch (e) {
    $upnpDeviceList.innerHTML = `<div class="upnp-empty">扫描失败: ${escHtml(e.message)}</div>`;
  } finally {
    upnpScanning = false;
  }
}

function renderUpnpDevices() {
  if (!upnpDevices.length) {
    $upnpDeviceList.innerHTML = '<div class="upnp-empty">未发现 DLNA 设备</div>';
    return;
  }
  $upnpDeviceList.innerHTML = upnpDevices.map((d, i) =>
    `<div class="upnp-device-item" data-uuid="${escHtml(d.uuid)}" data-idx="${i}">` +
    `<span class="upnp-device-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="7 21 12 17 17 21"/></svg>
    </span>` +
    `<span class="upnp-device-name">${escHtml(d.name)}</span>` +
    `<span class="upnp-device-host">${escHtml(d.host)}</span>` +
    `</div>`
  ).join('');

  // 绑定点击事件
  $upnpDeviceList.querySelectorAll('.upnp-device-item').forEach((el) => {
    el.addEventListener('click', () => pushToDevice(el.dataset.uuid));
  });
}

async function pushToDevice(uuid) {
  if (!currentSongUrl) {
    showToast('当前没有播放歌曲，无法推送');
    return;
  }
  const device = upnpDevices.find((d) => d.uuid === uuid);
  if (!device) return;

  // 视觉反馈
  const items = $upnpDeviceList.querySelectorAll('.upnp-device-item');
  items.forEach((el) => el.classList.remove('upnp-pushing'));
  const target = $upnpDeviceList.querySelector(`[data-uuid="${uuid.replace(/"/g, '\\"')}"]`);
  if (target) target.classList.add('upnp-pushing');

  try {
    const r = await fetch('/api/upnp/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ deviceUuid: uuid, audioUrl: currentSongUrl }),
    });
    const d = await r.json();
    if (d.ok) {
      // 推送成功后自动播放
      await fetch('/api/upnp/play', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ deviceUuid: uuid }),
      });
      showToast(`已推送到 ${device.name}`);
    } else {
      showToast(`推送失败: ${d.error || '未知错误'}`);
    }
  } catch (e) {
    showToast(`推送失败: ${e.message}`);
  } finally {
    if (target) target.classList.remove('upnp-pushing');
  }
}

$playerUpnp.addEventListener('click', () => {
  if ($upnpPanel.classList.contains('hidden')) {
    $upnpPanel.classList.remove('hidden');
    $recommendPanel.classList.add('hidden');
    upnpScan();
  } else {
    $upnpPanel.classList.add('hidden');
  }
});

$upnpClose.addEventListener('click', () => {
  $upnpPanel.classList.add('hidden');
});

$upnpRescan.addEventListener('click', () => {
  upnpScan();
});

$playerUnlock.addEventListener('click', async () => {
  audioUnlocked = true;
  if (pendingSong) { const s = pendingSong, seg = pendingSegue; pendingSong = null; pendingSegue = null; await playSong(s, seg); }
  else { showPlayerCard(); $playerTitle.textContent = '已启用,等待 Claudio 点歌…'; $playerArtist.textContent = ''; }
});
$playerToggle.addEventListener('click', () => {
  if ($audio.paused) { $audio.play(); $playerToggle.textContent = '⏸'; } else { $audio.pause(); $playerToggle.textContent = '▶'; }
});

function formatTime(sec) {
  if (isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${s < 10 ? '0' : ''}${s}`;
}
$audio.addEventListener('timeupdate', () => {
  if ($audio.duration) { $playerProgress.value = $audio.currentTime / $audio.duration; $playerCurrent.textContent = formatTime($audio.currentTime); $playerDuration.textContent = formatTime($audio.duration); }
  scrollLyrics($audio.currentTime);
});
$audio.addEventListener('ended', () => {
  $playerToggle.textContent = '▶';
  $playerProgress.value = 0;
  if (radioActive) fetchNextRadioTrack();
});

// ── Radio 模式 ─────────────────────────
let radioActive = false;

function enterRadioMode(status, firstTrack) {
  radioActive = true;
  $radioBar.classList.remove('hidden');
  $radioToggle.textContent = 'Radio 开';
  $radioToggle.classList.add('radio-on');
  $radioStopBtn.classList.remove('hidden');
  $radioSceneTag.classList.remove('hidden');
  $radioTrackCount.classList.remove('hidden');
  const sceneName = status?.scene || '自动';
  $radioSceneTag.textContent = sceneName;
  $radioTrackCount.textContent = '已播 1 首';
  if (firstTrack?.url) {
    playSong({ name: firstTrack.title, artist: firstTrack.artist, url: firstTrack.url, id: firstTrack.id || '' }, '');
  }
  showToast('Radio 已开启 · ' + sceneName);
}

function exitRadioMode() {
  radioActive = false;
  $radioBar.classList.add('hidden');
  $radioToggle.textContent = 'Radio 关';
  $radioToggle.classList.remove('radio-on');
  $radioStopBtn.classList.add('hidden');
  $radioSceneTag.classList.add('hidden');
  $radioTrackCount.classList.add('hidden');
  showToast('Radio 已关闭');
}

$radioToggle.addEventListener('click', async () => {
  if (radioActive) { await stopRadio(); return; }
  try {
    const r = await fetch('/api/radio/start', { method: 'POST', headers: { 'content-type': 'application/json', ...getAuthHeader() }, body: JSON.stringify({}) });
    const d = await r.json();
    if (d.ok) enterRadioMode(d.status, d.firstTrack);
    else showToast('Radio 启动失败: ' + (d.error || '未知错误'));
  } catch (e) { showToast('Radio 启动失败: ' + e.message); }
});

$radioStopBtn.addEventListener('click', () => stopRadio());

async function stopRadio() {
  try { await fetch('/api/radio/stop', { method: 'POST', headers: getAuthHeader() }); } catch (e) {}
  exitRadioMode();
}

async function fetchNextRadioTrack() {
  try {
    const r = await fetch('/api/radio/next', { headers: getAuthHeader() });
    const d = await r.json();
    if (d.ok && d.track) {
      playSong({ name: d.track.title, artist: d.track.artist, url: d.track.url, id: d.track.id || '' }, '');
      $radioTrackCount.textContent = '已播 ' + d.track.trackIndex + ' 首';
    } else showToast('获取下一首失败: ' + (d.error || '未知'));
  } catch (e) { showToast('Radio 切歌失败: ' + e.message); }
}

// ── WebSocket ──────────────────────────
function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  const sec = Math.round(reconnectDelay / 1000);
  setWsStatus('off', reason || `断开，${sec}s 后重连`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.6, 10000);
}

function connect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { const old = ws; ws = null; old.onopen = old.onclose = old.onerror = old.onmessage = null; if (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING) old.close(1000, 'reconnect'); }
  const gen = ++wsGen;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${location.host}/stream${apiToken ? `?token=${encodeURIComponent(apiToken)}` : ''}`;
  const socket = new WebSocket(wsUrl); ws = socket;
  socket.addEventListener('open', () => { if (gen !== wsGen) return; setWsStatus('on', '已连接'); reconnectDelay = 1000; });
  socket.addEventListener('close', (ev) => { if (gen !== wsGen) return; ws = null; if (ev.code === 1000 && ev.reason === 'reconnect') return; scheduleReconnect(); });
  socket.addEventListener('error', () => { if (gen !== wsGen) return; setWsStatus('err', '连接错误'); });
  socket.addEventListener('message', (e) => { if (gen !== wsGen) return; let evt; try { evt = JSON.parse(e.data); } catch { return; } if (evt.type === 'ping') return; handleEvent(evt); });
}

function handleEvent(evt) {
  log('←', evt);
  switch (evt.type) {
    case 'hello': break;
    case 'history-cleared': $chat.innerHTML = ''; break;
    case 'user-echo': break;
    case 'thinking': thinkingNode = appendMessage('asst', '思考中…'); thinkingNode.classList.add('thinking'); break;
    case 'say':
      if (thinkingNode) thinkingNode.remove(); thinkingNode = null;
      const isScheduled = evt.source && evt.source.startsWith('scheduled:');
      appendMessage('asst', evt.text || '(空)', { play: evt.play, scheduled: isScheduled });
      speak(evt.text, evt.ttsUrl); $send.disabled = false;
      if (!isScheduled) { $input.focus(); loadRecentChats(); }
      break;
    case 'resolving':
      if (resolvingNode) resolvingNode.remove();
      resolvingNode = appendMessage('asst', `正在搜歌「${evt.keyword}」…`); resolvingNode.classList.add('thinking'); break;
    case 'now-playing': if (resolvingNode) { resolvingNode.remove(); resolvingNode = null; } playSong(evt.song, evt.segue); break;
    case 'now-playing-failed':
      if (resolvingNode) { resolvingNode.remove(); resolvingNode = null; }
      { const err = document.createElement('div'); err.className = 'msg msg-error'; err.textContent = `× ${evt.text || `点歌失败：${evt.keyword}（${evt.error || '未知'}）`}`; $chat.appendChild(err); $chat.scrollTop = $chat.scrollHeight; }
      break;
    case 'error': if (thinkingNode) thinkingNode.remove(); thinkingNode = null; const err = document.createElement('div'); err.className = 'msg msg-error'; err.textContent = `× ${evt.message}`; $chat.appendChild(err); $chat.scrollTop = $chat.scrollHeight; $send.disabled = false; break;
    case 'radio-started':
      enterRadioMode({ scene: evt.scene, playedCount: 0 }, { title: '', artist: '', url: '' });
      break;
    case 'radio-stopped': exitRadioMode(); break;
    case 'radio-track':
      if (!radioActive) break;
      playSong({ name: evt.title, artist: evt.artist, url: evt.url, id: evt.id || '' }, '');
      $radioTrackCount.textContent = '已播 ' + (evt.trackIndex || '?') + ' 首';
      break;
    case 'radio-track-failed':
      showToast('Radio 选歌失败: ' + (evt.error || '未知'));
      break;
  }
}

// ── 聊天提交 ──────────────────────────
$form.addEventListener('submit', async (e) => {
  e.preventDefault(); const text = $input.value.trim(); if (!text) return;
  $input.value = ''; $send.disabled = true; appendMessage('user', text);
  if (!audioUnlocked) audioUnlocked = true;
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...getAuthHeader() }, body: JSON.stringify({ message: text }) });
    if (!r.ok) { const body = await r.json().catch(() => ({})); handleEvent({ type: 'error', message: body.error || `HTTP ${r.status}` }); }
  } catch (e) { handleEvent({ type: 'error', message: e.message }); }
});

$clearChat.addEventListener('click', async () => {
  if (!confirm('确定清空所有对话记录？此操作不可恢复。')) return;
  try {
    const r = await fetch('/api/state/clear', { method: 'POST', headers: getAuthHeader() });
    if (!r.ok) { const body = await r.json().catch(() => ({})); alert(body.error || `清空失败 HTTP ${r.status}`); return; }
    oldestTs = Infinity; $loadMore.classList.add('hidden'); $emptyState.classList.remove('hidden');
    [...$chat.children].forEach((c) => { if (c.classList.contains('msg') || c.classList.contains('msg-error')) c.remove(); });
  } catch (e) { alert(e.message); }
});

$debugToggle.addEventListener('click', () => { $debug.classList.toggle('hidden'); });
$loadMore.addEventListener('click', () => { loadChatHistory(true); });
$newChat.addEventListener('click', () => {
  oldestTs = Infinity; $loadMore.classList.add('hidden'); $emptyState.classList.remove('hidden');
  [...$chat.children].forEach((c) => { if (c.classList.contains('msg') || c.classList.contains('msg-error')) c.remove(); });
  $input.focus();
});

let oldestTs = Infinity;

async function loadRecentChats() {
  try {
    const r = await fetch('/api/messages?limit=10', { headers: getAuthHeader() });
    if (!r.ok) return; const { messages } = await r.json();
    $recentList.innerHTML = '';
    const userMsgs = messages.filter(m => m.role === 'user').reverse();
    const uniqueTitles = [...new Set(userMsgs.map(m => m.content.slice(0, 20)))].slice(0, 8);
    uniqueTitles.forEach(title => {
      const item = document.createElement('div'); item.className = 'recent-item'; item.textContent = title || '对话';
      item.onclick = () => { $emptyState.classList.add('hidden'); loadChatHistory(false); };
      $recentList.appendChild(item);
    });
  } catch (e) { console.warn('load recent chats failed:', e.message); }
}

async function loadChatHistory(prepend = false) {
  try {
    const limit = 40;
    const url = `/api/messages?limit=${limit}${prepend && oldestTs !== Infinity ? `&before=${oldestTs}` : ''}`;
    const r = await fetch(url, { headers: getAuthHeader() }); if (!r.ok) return;
    const { messages, hasMore } = await r.json();
    if (!prepend) { oldestTs = Infinity; [...$chat.children].forEach((c) => { if (c.classList.contains('msg') || c.classList.contains('msg-error')) c.remove(); }); }
    if (!Array.isArray(messages) || messages.length === 0) { $loadMore.classList.add('hidden'); return; }
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i], role = m.role === 'user' ? 'user' : 'asst';
      const isScheduled = m.source && m.source.startsWith('scheduled:') && !/^scheduled:test/.test(m.source);
      appendMessage(role, m.content, { play: m.play, scheduled: isScheduled, prepend });
      if (m.ts && m.ts < oldestTs) oldestTs = m.ts;
    }
    if (hasMore) $loadMore.classList.remove('hidden'); else $loadMore.classList.add('hidden');
    if (!prepend) $chat.scrollTop = $chat.scrollHeight;
  } catch (e) { log('加载历史失败:', e.message); }
}

// ═══════════════════════════════════════
//  PAGE ROUTING
// ═══════════════════════════════════════
const PAGE_KEY = 'claudio-page';

function getPageFromHash() {
  const h = window.location.hash.replace(/^#/, '');
  if (h === 'profile' || h === 'settings') return h;
  return 'player';
}

function setPage(page) { window.location.hash = '#' + page; }

function activatePage(page) {
  localStorage.setItem(PAGE_KEY, page);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'profile') loadProfile();
  else if (page === 'settings') loadSettings();
}

window.addEventListener('hashchange', () => activatePage(getPageFromHash()));
document.querySelectorAll('.nav-btn').forEach(btn => { btn.addEventListener('click', () => setPage(btn.dataset.page)); });

// ═══════════════════════════════════════
//  PROFILE PAGE
// ═══════════════════════════════════════
async function loadProfile() {
  try {
    const r = await fetch('/api/health', { headers: getAuthHeader() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();

    const pp = $('profile-persona');
    if (d.context?.persona?.name) {
      pp.innerHTML =
        `<div class="kv"><span class="k">名称</span><span class="v">${escHtml(d.context.persona.name)}</span></div>` +
        `<div class="kv"><span class="k">版本</span><span class="v">${escHtml(d.context.persona.version || '—')}</span></div>` +
        `<div class="kv"><span class="k">描述</span><span class="v">${escHtml(String(d.context.persona.description || '—').slice(0, 120))}</span></div>`;
    } else { pp.innerHTML = '<div class="empty-hint">未加载人设</div>'; }

    const ps = $('profile-scene');
    if (d.scene) {
      const s = d.scene;
      ps.innerHTML =
        `<div class="kv"><span class="k">时段</span><span class="v">${escHtml(s.routine?.name || '—')}</span></div>` +
        `<div class="kv"><span class="k">状态</span><span class="v">${escHtml(s.routine?.state || '—')}</span></div>` +
        `<div class="kv"><span class="k">心情</span><span class="v">${escHtml(s.mood || '—')}</span></div>` +
        `<div class="kv"><span class="k">推荐歌单</span><span class="v">${escHtml(s.playlist || '—')}</span></div>`;
    } else { ps.innerHTML = '<div class="empty-hint">场景信息不可用</div>'; }

    const pt = $('profile-taste');
    if (d.context?.taste) {
      const t = d.context.taste;
      pt.innerHTML =
        `<div class="kv"><span class="k">风格</span><span class="v">${escHtml(Array.isArray(t.genres) ? t.genres.join(' · ') : String(t.genres || '—'))}</span></div>` +
        `<div class="kv"><span class="k">歌手</span><span class="v">${escHtml(Array.isArray(t.artists) ? t.artists.join(' · ') : String(t.artists || '—'))}</span></div>` +
        `<div class="kv"><span class="k">讨厌风格</span><span class="v">${escHtml(Array.isArray(t.disliked) ? t.disliked.join(' · ') : String(t.disliked || '—'))}</span></div>`;
    } else { pt.innerHTML = '<div class="empty-hint">品味档案不可用</div>'; }

    const pm = $('profile-mood');
    if (d.context?.taste?.moodHistory && d.context.taste.moodHistory.length) {
      pm.innerHTML = d.context.taste.moodHistory.slice(-5).reverse().map(m =>
        `<div class="mood-item">` +
        `<span class="mood-date">${escHtml(m.date || '—')}</span>` +
        `<span class="mood-tag">${escHtml(m.mood || '—')}</span>` +
        `<span class="mood-note">${escHtml((m.note || '').slice(0, 60))}</span>` +
        `</div>`
      ).join('');
    } else { pm.innerHTML = '<div class="empty-hint">暂无心情记录</div>'; }

  } catch (e) { log('profile load failed:', e.message); }
}

// ═══════════════════════════════════════
//  SETTINGS PAGE
// ═══════════════════════════════════════
let editCache = {}, activeTab = 'taste';

async function loadSettings() {
  try {
    const r = await fetch('/api/health', { headers: getAuthHeader() });
    if (r.ok) {
      const d = await r.json();
      const sel = $('setting-provider');
      sel.innerHTML = '';
      const available = d.llm?.available || ['claude', 'openai', 'mock'];
      available.forEach(p => {
        const opt = document.createElement('option'); opt.value = p; opt.textContent = p;
        if (d.llm?.provider === p) opt.selected = true;
        sel.appendChild(opt);
      });
      const modelInput = $('setting-model');
      if (modelInput) {
        modelInput.value = d.llm?.model || d.llm?.detail?.model || '';
      }
    }
  } catch (e) { log('provider load failed:', e.message); }

  const ttsChk = $('setting-tts');
  ttsChk.checked = ttsEnabled;
  ttsChk.addEventListener('change', () => { ttsEnabled = ttsChk.checked; localStorage.setItem(TTS_PREF_KEY, ttsEnabled ? '1' : '0'); });

  const tok = $('setting-token');
  tok.value = apiToken || '';
  const updateTokenHint = () => { $('setting-token-hint').textContent = apiToken ? '已配置' : '未配置'; };
  updateTokenHint();
  tok.addEventListener('input', () => { apiToken = tok.value.trim(); localStorage.setItem('claudio-token', apiToken); updateTokenHint(); });

  await switchEditTab(activeTab);
}

async function switchEditTab(file) {
  activeTab = file;
  document.querySelectorAll('#edit-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === file));
  const ta = $('edit-textarea'), saveBtn = $('edit-save'), status = $('edit-status');
  saveBtn.disabled = false;
  status.textContent = '';
  status.style.color = '';

  if (editCache[file] !== undefined) {
    ta.value = editCache[file];
    return;
  }

  status.textContent = '加载中…';
  ta.value = '';
  try {
    const r = await fetch(`/api/profile/read?file=${file}`, { headers: getAuthHeader() });
    if (r.ok) {
      const d = await r.json();
      editCache[file] = d.content || '';
      ta.value = editCache[file];
      status.textContent = '';
    } else {
      status.textContent = '无法加载文件';
      status.style.color = '#ef4444';
    }
  } catch (e) {
    status.textContent = '加载失败: ' + e.message;
    status.style.color = '#ef4444';
  }
}

$('edit-textarea').addEventListener('input', () => {
  editCache[activeTab] = $('edit-textarea').value;
  const status = $('edit-status');
  status.textContent = '已修改 · 未保存';
  status.style.color = '#f59e0b';
});

document.getElementById('edit-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchEditTab(btn.dataset.tab);
});

$('edit-save').addEventListener('click', async () => {
  const ta = $('edit-textarea'), status = $('edit-status'), saveBtn = $('edit-save');
  status.textContent = '保存中…';
  saveBtn.disabled = true;
  try {
    const r = await fetch('/api/profile/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ file: activeTab, content: ta.value }),
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'HTTP ' + r.status); }
    const d = await r.json();
    status.textContent = '✓ 已保存';
    status.style.color = '#10b981';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3000);
  } catch (e) {
    status.textContent = '保存失败: ' + e.message;
    status.style.color = '#ef4444';
  }
  saveBtn.disabled = false;
});

// ── 保存 LLM 设置 ─────────────────────
async function saveLLMSettings(providerOnly = false) {
  const status = $('setting-status');
  const provider = $('setting-provider').value;
  const model = $('setting-model')?.value?.trim() || '';
  status.textContent = '保存中…';
  status.style.color = '';

  try {
    const body = {};
    if (provider) body.provider = provider;
    if (!providerOnly && model) body.model = model;
    else if (!providerOnly) body.model = '';  // 空字符串清空自定义 model

    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'HTTP ' + r.status); }

    status.textContent = providerOnly ? `✓ 已切换到 ${provider}` : '✓ 设置已保存';
    status.style.color = '#10b981';
    showToast(providerOnly ? `Provider 已切换为 ${provider}` : '设置已更新');
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3500);
  } catch (e) {
    status.textContent = '保存失败: ' + e.message;
    status.style.color = '#ef4444';
  }
}

$('setting-provider').addEventListener('change', () => saveLLMSettings(true));
$('setting-save').addEventListener('click', () => saveLLMSettings(false));

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch((e) => log('sw register failed:', e.message)); });
}
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = () => {}; speechSynthesis.getVoices(); }

const savedTts = localStorage.getItem(TTS_PREF_KEY);
if (savedTts !== null) ttsEnabled = savedTts === '1';

const initPage = getPageFromHash() || localStorage.getItem(PAGE_KEY) || 'player';
if (getPageFromHash() !== initPage) window.location.hash = '#' + initPage;
else activatePage(initPage);

fetch('/api/now', { headers: getAuthHeader() }).then((r) => r.json()).then((d) => {
  if (d.song?.url) { pendingSong = d.song; pendingSegue = d.song.segue; showPlayerUnlock(); }
}).catch(() => {});
loadRecentChats();
connect();
$input.focus();