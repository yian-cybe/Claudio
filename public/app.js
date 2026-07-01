/* ============================================================
   Claudio Radio v1 — 首页 Mock + 聊天链路
   ============================================================ */
const $ = (id) => document.getElementById(id);

// ── DOM ──
const $pixelCharacter = $('pixel-character');
const $pixelName   = $('pixel-name');
const $waveCanvas  = $('wave-canvas');
const $waveStatus  = $('wave-status');
const $subtitleHistory = $('subtitle-history');
const $chatInput   = $('chat-input');
const $chatSend    = $('chat-send');
const $chatArea = $('chat-area');
const $chatClose = $('chat-close');
const $talkAction = $('talk-action');
const $musicAction = $('music-action');
const $musicPanel = $('music-panel');
const $musicClose = $('music-close');
const $musicMoods = $('music-moods');
const $musicPanelList = $('music-panel-list');
const $settingsAction = $('settings-action');
const $settingsPanel = $('settings-panel');
const $settingsClose = $('settings-close');
const $connectionState = $('connection-state');
const $settingProvider = $('setting-provider');
const $settingModel = $('setting-model');
const $settingDetail = $('setting-detail');
const $usageDetail = $('usage-detail');
const $billingProduct = $('billing-product');
const $billingStatus = $('billing-status');
const $payWechat = $('pay-wechat');
const $payAlipay = $('pay-alipay');
const $paymentQr = $('payment-qr');
const $paymentQrImage = $('payment-qr-image');
const $paymentQrStatus = $('payment-qr-status');
const $settingSave = $('setting-save');
const $settingClear = $('setting-clear');
const $settingStatus = $('setting-status');
const $deskClock = $('desk-clock');
const $dinoScrollbar = $('dino-scrollbar');
const $dinoScrollTrack = $('dino-scroll-track');
const $dinoScrollThumb = $('dino-scroll-thumb');
const $authForm = $('auth-form');
const $authEmail = $('auth-email');
const $authPassword = $('auth-password');
const $authSubmit = $('auth-submit');
const $authMode = $('auth-mode');
const $authStatus = $('auth-status');
const $accountLogout = $('account-logout');

function updateDeskClock() {
  $deskClock.textContent = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
updateDeskClock();
setInterval(updateDeskClock, 30000);

// ── 小恐龙页面滚动条 ──
let dinoScrollDragging = false;
let dinoScrollGrabOffset = 0;

function scrollMetrics() {
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const trackHeight = $dinoScrollTrack.clientHeight;
  const thumbHeight = $dinoScrollThumb.offsetHeight;
  return { maxScroll, maxThumbTop: Math.max(0, trackHeight - thumbHeight) };
}

function syncDinoScrollbar() {
  const { maxScroll, maxThumbTop } = scrollMetrics();
  $dinoScrollbar.classList.toggle('visible', maxScroll > 100);
  const ratio = maxScroll ? window.scrollY / maxScroll : 0;
  $dinoScrollThumb.style.transform = `translateY(${ratio * maxThumbTop}px)`;
}

function dragDinoScrollbar(clientY) {
  const rect = $dinoScrollTrack.getBoundingClientRect();
  const { maxScroll, maxThumbTop } = scrollMetrics();
  const thumbTop = Math.min(maxThumbTop, Math.max(0, clientY - rect.top - dinoScrollGrabOffset));
  const ratio = maxThumbTop ? thumbTop / maxThumbTop : 0;
  window.scrollTo({ top: ratio * maxScroll, behavior: 'auto' });
}

$dinoScrollThumb.addEventListener('pointerdown', (event) => {
  dinoScrollDragging = true;
  const thumbRect = $dinoScrollThumb.getBoundingClientRect();
  dinoScrollGrabOffset = event.clientY - thumbRect.top;
  $dinoScrollThumb.classList.add('dragging');
  $dinoScrollThumb.setPointerCapture(event.pointerId);
  event.preventDefault();
});

$dinoScrollThumb.addEventListener('pointermove', (event) => {
  if (dinoScrollDragging) dragDinoScrollbar(event.clientY);
});

function stopDinoScrollDrag(event) {
  if (!dinoScrollDragging) return;
  dinoScrollDragging = false;
  $dinoScrollThumb.classList.remove('dragging');
  if ($dinoScrollThumb.hasPointerCapture(event.pointerId)) {
    $dinoScrollThumb.releasePointerCapture(event.pointerId);
  }
}

$dinoScrollThumb.addEventListener('pointerup', stopDinoScrollDrag);
$dinoScrollThumb.addEventListener('pointercancel', stopDinoScrollDrag);
$dinoScrollTrack.addEventListener('pointerdown', (event) => {
  if (event.target === $dinoScrollThumb || $dinoScrollThumb.contains(event.target)) return;
  dinoScrollGrabOffset = $dinoScrollThumb.offsetHeight / 2;
  dragDinoScrollbar(event.clientY);
});
window.addEventListener('scroll', syncDinoScrollbar, { passive: true });
window.addEventListener('resize', syncDinoScrollbar);
new ResizeObserver(syncDinoScrollbar).observe(document.documentElement);
syncDinoScrollbar();

// ── Radio 状态 ──
let radioState = 'idle';
let speakingTimer = null;

function setRadioState(next) {
  radioState = next;
  document.body.dataset.radioState = next;
  const labels = {
    idle: '聆听中…',
    thinking: '正在想…',
    speaking: '正在播报',
  };
  $waveStatus.textContent = labels[next] || labels.idle;
  $waveStatus.classList.toggle('active', next !== 'idle');
}

function finishSpeakingLater(text) {
  clearTimeout(speakingTimer);
  speakingTimer = setTimeout(() => setRadioState('idle'), Math.max(1600, String(text).length * 85));
}

// ── Radio 字幕 ──
let chatMessages = [];

function addMessage(role, text) {
  if (!text) return;
  chatMessages.push({ role, text, time: Date.now() });
  const div = document.createElement('div');
  div.className = 'subtitle-line ' + role;
  div.textContent = text;
  for (const line of $subtitleHistory.children) line.classList.remove('current');
  div.classList.add('current');
  $subtitleHistory.appendChild(div);
  requestAnimationFrame(() => div.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  while ($subtitleHistory.children.length > 12) {
    $subtitleHistory.removeChild($subtitleHistory.firstChild);
  }
}

// 初始欢迎消息
addMessage('ai', '欢迎来到 Claudio Radio — 你的 AI 音乐电台');

// ── 声波 Canvas ──
const WAVE_BARS = 64;
function drawWaveform() {
  const c = $waveCanvas;
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = c.offsetWidth * dpr;
  c.height = c.offsetHeight * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, c.width, c.height);
  const w = c.offsetWidth, h = c.offsetHeight;
  const gap = 2, bw = (w - gap * (WAVE_BARS - 1)) / WAVE_BARS;
  const now = Date.now();
  for (let i = 0; i < WAVE_BARS; i++) {
    let amp;
    if (radioState === 'speaking') {
      amp = 0.16 + Math.abs(Math.sin(i * 0.82 + now * 0.009)) * 0.58 + Math.random() * 0.14;
    } else if (radioState === 'thinking') {
      const focus = (Math.sin(i * 0.28 - now * 0.006) + 1) / 2;
      amp = 0.08 + focus * 0.36;
    } else {
      amp = 0.07 + Math.abs(Math.sin(i * 0.22 + now * 0.0012)) * 0.17;
    }
    const barH = Math.max(2, amp * h);
    const x = i * (bw + gap), y = (h - barH) / 2;
    const gradient = ctx.createLinearGradient(x, y, x, y + barH);
    gradient.addColorStop(0, '#4ade80');
    gradient.addColorStop(1, 'rgba(74,222,128,0.2)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, barH, 1);
    ctx.fill();
  }
  requestAnimationFrame(drawWaveform);
}
drawWaveform();

// ── 聊天发送 ──
function sendText(text) {
  text = String(text || '').trim();
  if (!text) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    addMessage('ai', '连接未就绪，请稍后再试');
    return;
  }
  ws.send(JSON.stringify({ type: 'chat', text }));
  addMessage('user', text);
  $chatInput.value = '';
  $chatInput.disabled = true;
  $chatSend.disabled = true;
  closeTalk();
  closePanel($musicPanel);
  setRadioState('thinking');
}

function sendChat() {
  sendText($chatInput.value);
}

$chatSend.addEventListener('click', sendChat);
$chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  if (e.key === 'Escape') closeTalk();
});

function openTalk() {
  $chatArea.classList.add('open');
  $chatArea.setAttribute('aria-hidden', 'false');
  $talkAction.classList.add('active');
  setTimeout(() => $chatInput.focus(), 120);
}

function closeTalk() {
  $chatArea.classList.remove('open');
  $chatArea.setAttribute('aria-hidden', 'true');
  $talkAction.classList.remove('active');
}

$talkAction.addEventListener('click', () => $chatArea.classList.contains('open') ? closeTalk() : openTalk());
$chatClose.addEventListener('click', closeTalk);
function openPanel(panel) {
  for (const item of document.querySelectorAll('.modal-panel.open')) closePanel(item);
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
}

function closePanel(panel) {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}

$musicAction.addEventListener('click', () => openPanel($musicPanel));
$musicClose.addEventListener('click', () => closePanel($musicPanel));
$musicMoods.addEventListener('click', (event) => {
  const button = event.target.closest('[data-prompt]');
  if (button) sendText(button.dataset.prompt);
});
$settingsAction.addEventListener('click', async () => {
  openPanel($settingsPanel);
  await Promise.all([loadSettings(), loadUsage(), loadBilling()]);
});
$settingsClose.addEventListener('click', () => closePanel($settingsPanel));

// ── WebSocket ──
const urlParams = new URLSearchParams(window.location.search);
let apiToken = urlParams.get('token') || localStorage.getItem('claudio-token') || '';
if (urlParams.get('token')) {
  localStorage.setItem('claudio-token', apiToken);
  window.history.replaceState({}, '', window.location.pathname + window.location.hash);
}

let ws = null, wsGen = 0, reconnectTimer = null, reconnectDelay = 1000;
let authAction = 'login';

function showAuthGate(message = '') {
  document.body.classList.add('auth-required');
  $authStatus.textContent = message;
}

function hideAuthGate() {
  document.body.classList.remove('auth-required');
  $authStatus.textContent = '';
}

async function initializeAuth() {
  try {
    const verificationToken = urlParams.get('verify');
    if (verificationToken) {
      const verifyResponse = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: verificationToken }),
      });
      const verifyData = await verifyResponse.json();
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      if (!verifyResponse.ok) throw new Error(verifyData.error || 'Email verification failed');
    }
    const response = await fetch('/api/auth/me', { headers: authHeaders() });
    const data = await response.json();
    if (data.emailVerificationRequired && data.user && !data.user.emailVerified) {
      showAuthGate('请先打开验证邮件中的链接，再返回 Claudio。');
      return;
    }
    if (data.authenticated || data.guestAllowed || apiToken) {
      hideAuthGate();
      connectWs();
    } else {
      showAuthGate();
    }
  } catch (error) {
    showAuthGate(`无法连接 Claudio：${error.message}`);
  }
}

$authMode.addEventListener('click', () => {
  authAction = authAction === 'login' ? 'register' : 'login';
  $authSubmit.textContent = authAction === 'login' ? '登录' : '创建账号并进入';
  $authMode.textContent = authAction === 'login' ? '第一次来？创建账号' : '已有账号？返回登录';
  $authPassword.autocomplete = authAction === 'login' ? 'current-password' : 'new-password';
  $authStatus.textContent = '';
});

$authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  $authSubmit.disabled = true;
  $authStatus.textContent = authAction === 'login' ? '正在登录…' : '正在创建账号…';
  try {
    const response = await fetch(`/api/auth/${authAction}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: $authEmail.value, password: $authPassword.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.emailVerificationRequired && !data.user?.emailVerified) {
      const developmentHint = data.verificationUrl ? ` 开发验证链接：${data.verificationUrl}` : '';
      showAuthGate(`账号已创建，请先验证邮箱。${developmentHint}`);
      return;
    }
    hideAuthGate();
    connectWs();
  } catch (error) {
    $authStatus.textContent = error.message;
  } finally {
    $authSubmit.disabled = false;
  }
});

$accountLogout.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
  localStorage.removeItem('claudio-token');
  apiToken = '';
  wsGen++;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  closePanel($settingsPanel);
  showAuthGate('已退出登录');
});

function connectWs() {
  if (ws) {
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try { ws.close(); } catch (e) {}
  }
  const gen = ++wsGen;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const tokenParam = apiToken ? '?token=' + encodeURIComponent(apiToken) : '';
  const url = proto + '://' + window.location.host + '/ws' + tokenParam;

  console.log('[Claudio] Connecting to:', url);
  ws = new WebSocket(url);

  ws.onopen = () => {
    if (gen === wsGen) {
      console.log('[Claudio] WS connected');
      reconnectDelay = 1000;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      $connectionState.textContent = '已连接';
      setRadioState('idle');
    }
  };

  ws.onclose = (event) => {
    if (gen === wsGen) {
      console.log('[Claudio] WS closed (code: ' + event.code + '), reconnecting in ' + reconnectDelay + 'ms...');
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWs, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
      $connectionState.textContent = '正在重连';
      addMessage('ai', '网络连接断开，正在尝试重连...');
    }
  };

  ws.onerror = (err) => {
    console.error('[Claudio] WS error:', err);
    if (gen === wsGen) ws.close();
  };

  ws.onmessage = (e) => {
    if (gen !== wsGen) return;
    try {
      const msg = JSON.parse(e.data);
      handleWsMessage(msg);
    } catch (err) {
      console.error('[Claudio] Failed to parse message:', err);
    }
  };
}
initializeAuth();

// ── 推荐卡片 ──
const $recommendArea = $('recommend-area');

function showRecommendations(play, reason) {
  if (!play || !Array.isArray(play) || play.length === 0) {
    $recommendArea.style.display = 'none';
    $recommendArea.replaceChildren();
    if (!$musicPanelList.querySelector('.recommend-card')) {
      $musicPanelList.innerHTML = '<span class="panel-empty">最近还没有音乐推荐</span>';
    }
    return;
  }

  const header = document.createElement('div');
  header.className = 'recommend-header';
  header.textContent = '音乐推荐';
  const fragment = document.createDocumentFragment();
  fragment.appendChild(header);

  play.forEach((kw) => {
    const keyword = String(kw);
    const encoded = encodeURIComponent(keyword);
    const card = document.createElement('div');
    card.className = 'recommend-card';

    const info = document.createElement('div');
    info.className = 'recommend-info';
    const song = document.createElement('span');
    song.className = 'recommend-song';
    song.textContent = keyword;
    const why = document.createElement('span');
    why.className = 'recommend-reason';
    why.textContent = reason || '这首歌可能适合现在的你。';
    info.append(song, why);

    const links = document.createElement('div');
    links.className = 'recommend-links';
    links.append(
      musicLink('网易云', 'netease', 'https://music.163.com/#/search/m/?s=' + encoded),
      musicLink('Spotify', 'spotify', 'https://open.spotify.com/search/' + encoded),
    );
    card.append(info, links);
    fragment.appendChild(card);
  });

  $recommendArea.replaceChildren(fragment);
  $recommendArea.style.display = 'flex';
  $musicPanelList.replaceChildren(...[...$recommendArea.querySelectorAll('.recommend-card')].map((card) => card.cloneNode(true)));
}

function musicLink(label, platform, href) {
  const link = document.createElement('a');
  link.className = `recommend-link ${platform}`;
  link.textContent = label;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function authHeaders(extra = {}) {
  return apiToken ? { ...extra, Authorization: `Bearer ${apiToken}` } : extra;
}

async function loadSettings() {
  $settingDetail.textContent = '正在读取后端状态…';
  try {
    const response = await fetch('/api/settings', { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    $settingProvider.replaceChildren(...data.available.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name === 'openai' && data.service === 'deepseek'
        ? 'DeepSeek API'
        : name;
      option.selected = name === data.provider;
      return option;
    }));
    $settingModel.value = data.model || '';
    $settingProvider.disabled = !data.mutable;
    $settingModel.disabled = !data.mutable;
    $settingSave.hidden = !data.mutable;
    $settingDetail.textContent = data.offline
      ? `离线降级中：${(data.recentFailures || []).map((item) => `${item.provider}: ${item.error}`).join(' | ') || data.lastFailure || '主模型不可用'}`
      : `后端在线 · ${data.service === 'deepseek' ? 'DeepSeek API' : data.provider} · ${data.model || '默认模型'} · ${data.baseURL}`;
    $settingStatus.textContent = data.mutable ? '' : '云端模型由 Claudio 安全管理';
    $settingDetail.classList.toggle('error', !!data.offline);
  } catch (error) {
    $settingDetail.textContent = `后端不可用：${error.message}`;
    $settingDetail.classList.add('error');
  }
}

function renderUsage(data) {
  const allowance = data.limit === null
    ? 'Unlimited AI replies'
    : `${data.remaining} of ${data.limit} AI replies remaining today`;
  const cost = data.costConfigured
    ? ` · estimated $${Number(data.estimatedCostUsd || 0).toFixed(4)}`
    : '';
  $usageDetail.textContent = `${String(data.plan || 'free').toUpperCase()} · ${allowance} · ${data.tokens?.total || 0} tokens${cost}`;
  $usageDetail.classList.toggle('warning', data.allowed === false);
}

async function loadUsage() {
  try {
    const response = await fetch('/api/usage', { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    renderUsage(data);
  } catch (error) {
    $usageDetail.textContent = `Allowance unavailable: ${error.message}`;
    $usageDetail.classList.add('warning');
  }
}

let paymentPollTimer = null;

function stopPaymentPolling() {
  if (paymentPollTimer) clearTimeout(paymentPollTimer);
  paymentPollTimer = null;
}

async function loadBilling() {
  try {
    const response = await fetch('/api/billing/status', { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const product = data.product;
    if (product) {
      $billingProduct.textContent = `${product.durationDays} 天 · ¥${(product.amountFen / 100).toFixed(0)}`;
    }
    $payWechat.hidden = !data.providers?.wechat;
    $payAlipay.hidden = !data.providers?.alipay;
    $billingStatus.textContent = data.checkoutAvailable
      ? `当前套餐：${String(data.plan || 'free').toUpperCase()}`
      : '支付通道尚未配置，暂时不能购买';
  } catch (error) {
    $billingStatus.textContent = `支付状态不可用：${error.message}`;
  }
}

async function pollPayment(orderId) {
  stopPaymentPolling();
  try {
    const response = await fetch(`/api/payments/orders/${encodeURIComponent(orderId)}`, {
      headers: authHeaders(),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.order.status === 'paid') {
      $paymentQrStatus.textContent = '支付成功，Pro 已生效';
      await Promise.all([loadBilling(), loadUsage()]);
      return;
    }
    $paymentQrStatus.textContent = '等待支付确认，请使用手机扫码';
    paymentPollTimer = setTimeout(() => pollPayment(orderId), 2500);
  } catch (error) {
    $paymentQrStatus.textContent = `订单状态读取失败：${error.message}`;
  }
}

async function startCheckout(providerName) {
  stopPaymentPolling();
  $payWechat.disabled = true;
  $payAlipay.disabled = true;
  $billingStatus.textContent = '正在创建安全订单…';
  try {
    const response = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ provider: providerName }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    $paymentQrImage.src = data.qrDataUrl;
    $paymentQr.hidden = false;
    $paymentQrStatus.textContent = providerName === 'wechat'
      ? '请使用微信扫码支付'
      : '请使用支付宝扫码支付';
    $billingStatus.textContent = `订单金额：¥${(data.order.amountFen / 100).toFixed(2)}`;
    pollPayment(data.order.id);
  } catch (error) {
    $billingStatus.textContent = `创建订单失败：${error.message}`;
  } finally {
    $payWechat.disabled = false;
    $payAlipay.disabled = false;
  }
}

$payWechat.addEventListener('click', () => startCheckout('wechat'));
$payAlipay.addEventListener('click', () => startCheckout('alipay'));

$settingSave.addEventListener('click', async () => {
  $settingStatus.textContent = '保存中…';
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ provider: $settingProvider.value, model: $settingModel.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    $settingStatus.textContent = `已切换到 ${data.provider} / ${data.model}`;
    await loadSettings();
  } catch (error) {
    $settingStatus.textContent = `保存失败：${error.message}`;
  }
});

$settingClear.addEventListener('click', async () => {
  $settingStatus.textContent = '清理中…';
  try {
    const response = await fetch('/api/state/clear', { method: 'POST', headers: authHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    $subtitleHistory.replaceChildren();
    addMessage('ai', '之前的对话已经清空，我们重新开始。');
    $settingStatus.textContent = '对话历史已清空';
  } catch (error) {
    $settingStatus.textContent = `清理失败：${error.message}`;
  }
});

function handleWsMessage(msg) {
  if (!msg) return;
  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      break;
    case 'hello':
      $connectionState.textContent = '已连接';
      break;
    case 'history-cleared':
      $subtitleHistory.replaceChildren();
      addMessage('ai', '之前的对话已经清空，我们重新开始。');
      break;
    case 'say':
      if (msg.text) {
        addMessage('ai', msg.text);
        setRadioState('speaking');
        finishSpeakingLater(msg.text);
      }
      showRecommendations(msg.play, msg.reason);
      $chatInput.disabled = false;
      $chatSend.disabled = false;
      if ($settingsPanel.classList.contains('open')) loadUsage();
      break;
    case 'subtitle':
    case 'text':
      if (msg.text) addMessage('ai', msg.text);
      break;
    case 'thinking':
      setRadioState('thinking');
      break;
    case 'speaking_start':
      setRadioState('speaking');
      break;
    case 'speaking_end':
      setRadioState('idle');
      break;
    case 'error':
      if (msg.message) addMessage('ai', msg.message);
      $chatInput.disabled = false;
      $chatSend.disabled = false;
      setRadioState('idle');
      break;
    case 'quota':
      renderUsage(msg.usage || {});
      addMessage('ai', msg.message || 'Daily AI reply limit reached.');
      $chatInput.disabled = false;
      $chatSend.disabled = false;
      setRadioState('idle');
      break;
    case 'rate-limit':
      addMessage('ai', msg.message || 'Too many messages. Please wait before trying again.');
      $chatInput.disabled = false;
      $chatSend.disabled = false;
      setRadioState('idle');
      break;
  }
}

setRadioState('idle');
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.warn('[Claudio] service worker registration failed:', error.message);
  });
}
console.log('[Claudio Radio v1] Radio UI ready');
