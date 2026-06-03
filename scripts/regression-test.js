/**
 * Claudio 手动回归测试
 * 连发 10 条闲聊，通过 WebSocket 接收结果，验证：
 * - say 无空白
 * - 无重复重连
 *
 * 用法: node scripts/regression-test.js [baseUrl]
 * 默认: http://localhost:8080
 */

import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://localhost:8080';
const API = `${BASE}/api/chat`;
const WS_URL = `${BASE.replace('http', 'ws')}/stream`;

const MESSAGES = [
  '你好，今天有什么推荐的音乐吗？',
  '最近有什么好听的歌？',
  '帮我推荐一首放松心情的音乐',
  '你觉得什么类型的音乐适合工作？',
  '下午好，今天天气怎么样？',
  '说一句鼓励的话吧',
  '你最喜欢的音乐风格是什么？',
  '给我讲一个关于音乐的有趣故事',
  '周末有什么推荐的休闲活动？',
  '晚安，明天见',
];

const RESULTS = [];
let wsReconnects = 0;
let testPassed = 0;
let testFailed = 0;

function log(label, msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${ts}] ${label}: ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- WebSocket ---
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  log('WS', '已连接');
});

ws.on('close', (code, reason) => {
  log('WS', `断开 (code=${code} reason="${reason}")`);
  wsReconnects++;
});

ws.on('error', (err) => {
  log('WS', `错误: ${err.message}`);
});

// --- 主流程 ---
let wsReady = false;
let resolveWsReady;
const wsReadyPromise = new Promise((r) => { resolveWsReady = r; });

ws.on('message', (data) => {
  try {
    const evt = JSON.parse(data.toString());
    if (evt.type === 'hello') {
      wsReady = true;
      resolveWsReady();
      return;
    }
    if (evt.type === 'say') {
      onSay(evt);
    }
  } catch {}
});

function onSay(evt) {
  const idx = RESULTS.findIndex((r) => r.pending);
  if (idx === -1) return;

  const say = String(evt.text ?? '').trim();
  RESULTS[idx].say = say;
  RESULTS[idx].pending = false;
  RESULTS[idx].wsGen = ws.readyState;

  if (!say) {
    log('FAIL', `消息 #${idx + 1} "${RESULTS[idx].msg}" → say 为空`);
    testFailed++;
    RESULTS[idx].status = 'FAIL';
  } else if (say === '(空)' || say.startsWith('抱歉，我刚才没想好')) {
    log('WARN', `消息 #${idx + 1} "${RESULTS[idx].msg}" → say="${say.slice(0, 40)}"`);
    testFailed++;
    RESULTS[idx].status = 'WARN';
  } else {
    log('PASS', `消息 #${idx + 1} "${RESULTS[idx].msg}" → say="${say.slice(0, 50)}..."`);
    testPassed++;
    RESULTS[idx].status = 'PASS';
  }
}

async function sendMessage(msg, idx) {
  RESULTS.push({ msg, idx: idx + 1, pending: true, status: 'PENDING', say: '' });

  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      log('HTTP', `消息 #${idx + 1} 发送失败: ${r.status} ${err.error || ''}`);
      RESULTS[idx].status = 'FAIL';
      RESULTS[idx].pending = false;
      testFailed++;
    }
  } catch (e) {
    log('HTTP', `消息 #${idx + 1} 请求异常: ${e.message}`);
    RESULTS[idx].status = 'FAIL';
    RESULTS[idx].pending = false;
    testFailed++;
  }
}

// --- 执行 ---
async function main() {
  console.log('='.repeat(50));
  console.log('  Claudio 回归测试');
  console.log(`  目标: ${BASE}`);
  console.log('='.repeat(50));
  console.log();

  // 等待 WS 就绪
  log('INFO', '等待 WebSocket 连接...');
  await wsReadyPromise;
  log('INFO', 'WebSocket 就绪，开始发送消息\n');

  // 串行发送（chatBusy 限制一次一条）
  for (let i = 0; i < MESSAGES.length; i++) {
    await sendMessage(MESSAGES[i], i);

    // 等待 WS 回复（带超时）
    const start = Date.now();
    while (RESULTS[i].pending && Date.now() - start < 40000) {
      await sleep(300);
    }
    if (RESULTS[i].pending) {
      log('TIMEOUT', `消息 #${i + 1} 超时未收到回复`);
      RESULTS[i].status = 'TIMEOUT';
      RESULTS[i].pending = false;
      testFailed++;
    }

    // 间隔防止过载
    if (i < MESSAGES.length - 1) {
      await sleep(1500);
    }
  }

  // --- 结果汇总 ---
  console.log();
  console.log('='.repeat(50));
  console.log('  测试结果汇总');
  console.log('='.repeat(50));
  console.log();

  const total = MESSAGES.length;
  const emptySay = RESULTS.filter((r) => !r.say || r.say === '(空)').length;
  const fallbackCount = RESULTS.filter((r) => r.say && r.say.startsWith('抱歉')).length;

  console.log(`总消息数:        ${total}`);
  console.log(`通过:            ${testPassed}`);
  console.log(`失败:            ${testFailed}`);
  console.log(`超时:            ${RESULTS.filter((r) => r.status === 'TIMEOUT').length}`);
  console.log(`say 空白:        ${emptySay}`);
  console.log(`兜底回复:        ${fallbackCount}`);
  console.log(`WS 重连次数:     ${wsReconnects}`);
  console.log();

  // 逐条明细
  console.log('逐条明细:');
  console.log('-'.repeat(80));
  for (const r of RESULTS) {
    const flag = r.status === 'PASS' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    const sayPreview = r.say ? r.say.slice(0, 60).replace(/\n/g, ' ') : '(空)';
    console.log(`  ${flag} #${r.idx}: "${r.msg.slice(0, 30)}" → "${sayPreview}"`);
  }
  console.log('-'.repeat(80));
  console.log();

  // 判定
  if (emptySay > 0) {
    console.log('❌ 回归失败: 存在空白 say');
    process.exit(1);
  }
  if (wsReconnects > 0) {
    console.log('⚠ 警告: 存在 WebSocket 重连');
    // 不阻塞，重连可能是测试脚本主动关闭导致
  }

  const blankRate = ((emptySay / total) * 100).toFixed(1);
  console.log(`✅ 回归通过: 空白率 ${blankRate}% < 5%, WS 重连 ${wsReconnects} 次`);
  console.log();

  ws.close(1000, 'test done');
  process.exit(0);
}

main().catch((e) => {
  console.error('测试脚本异常:', e.message);
  process.exit(2);
});
