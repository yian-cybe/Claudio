# Claudio — 个人 AI 电台

LLM 当大脑（Claude / OpenAI / DeepSeek / Ollama 四选一），Node 中枢 + PWA 前端。

**核心闭环**：用户输入 → Router 分流 → LLM 推理 → TTS 合成 + 网易云播放。支持定时播报、天气日程注入、对话历史、RAG 向量记忆、Radio 连续播放、UPnP 推流。

> 架构可视化：[claudio-api-visualization.html](docs/claudio-api-visualization.html)（含连线、联动高亮、滚动吸附）

---

## 1. 快速启动

### 克隆 & 安装

```bash
git clone https://github.com/yian-cybe/Claudio.git
cd Claudio
npm install
```

### 最小配置运行（Mock 模式）

无需任何 API Key 即可体验 UI 和流程：

```bash
npm start
# 或在 Windows 上直接双击 start.bat
```

打开 `http://localhost:8080`，输入文字，Mock 模式返回随机示例响应。

### 生产配置运行（DeepSeek 推荐，国内最稳）

```bash
# Windows PowerShell
$env:LLM_PROVIDER="openai"
$env:OPENAI_API_KEY="sk-xxx"
$env:OPENAI_BASE_URL="https://api.deepseek.com/v1"
$env:OPENAI_MODEL="deepseek-chat"
npm start
```

```bash
# macOS / Linux
LLM_PROVIDER=openai \
  OPENAI_API_KEY=sk-xxx \
  OPENAI_BASE_URL=https://api.deepseek.com/v1 \
  OPENAI_MODEL=deepseek-chat \
  npm start
```

### 首次验证

```bash
curl http://localhost:8080/api/health
# 返回 {"ok":true,"llm":{"provider":"openai","ready":true,...},...}
```

---

## 2. 环境变量（全部 API Key 清单）

### LLM 核心

| 变量 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `LLM_PROVIDER` | 否 | `auto` / `claude` / `openai` / `mock` | `openai` |
| `OPENAI_API_KEY` | 条件* | OpenAI 兼容协议的 API Key | `sk-xxx` |
| `OPENAI_BASE_URL` | 否 | 自定义端点（DeepSeek/通义/Kimi） | `https://api.deepseek.com/v1` |
| `OPENAI_MODEL` | 否 | 模型名，默认 `gpt-4o-mini` | `deepseek-chat` |
| `CLAUDE_MODEL` | 否 | Claude CLI provider 使用的模型 | `claude-opus-4-7[1m]` |
| `LLM_MAX_RETRIES` | 否 | 失败重试次数，默认 1 | `3` |

\* 当 `LLM_PROVIDER=openai` 或 `auto` 时必填

### Ollama 离线降级

| 变量 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `OLLAMA_FALLBACK` | 否 | 启用 Ollama 降级（需本地运行 ollama） | `true` |
| `OLLAMA_MODEL` | 否 | 本地模型名，默认 `qwen2.5:3b` | `llama3:8b` |
| `OLLAMA_BASE_URL` | 否 | Ollama API 地址 | `http://localhost:11434` |

### 天气

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENWEATHER_API_KEY` | 否 | [注册免费 Key](https://openweathermap.org/api) |
| `OPENWEATHER_CITY` | 否 | 城市，默认 `Beijing,CN` |

### Fish Audio TTS（可选）

| 变量 | 必填 | 说明 |
|------|------|------|
| `FISH_AUDIO_API_KEY` | 是 | [Fish Audio](https://fish.audio) API Key |
| `FISH_AUDIO_MODEL` | 否 | 模型，默认 `s2-pro` |
| `FISH_AUDIO_REFERENCE_ID` | 否 | 音色参考 ID |

### RSS 资讯

| 变量 | 必填 | 说明 |
|------|------|------|
| `RSS_ENABLED` | 否 | 启用 RSS 注入，默认 `false` |
| `RSS_SOURCES` | 否 | 逗号分隔的 RSS URL |
| `RSS_MAX_ITEMS` | 否 | 每次取多少条，默认 5 |

### RAG 向量记忆

| 变量 | 必填 | 说明 |
|------|------|------|
| `RAG_ENABLED` | 否 | 启用语义检索，默认 `true` |
| `EMBEDDING_API_KEY` | 否 | 嵌入服务 API Key（回退复用 `OPENAI_API_KEY`） |
| `EMBEDDING_BASE_URL` | 否 | 嵌入服务 URL |
| `EMBEDDING_MODEL` | 否 | 嵌入模型 |

### 安全 & 网络

| 变量 | 必填 | 说明 |
|------|------|------|
| `API_TOKEN` | 建议 | 设置后所有 API 需 Bearer Token 校验 |
| `PORT` | 否 | 服务端口，默认 `8080` |
| `HOST` | 否 | 监听地址，默认 `0.0.0.0`（设为 `127.0.0.1` 仅本地） |
| `WS_PING_MS` | 否 | WebSocket 心跳间隔，默认 `25000` |

### 对话

| 变量 | 必填 | 说明 |
|------|------|------|
| `CONTEXT_HISTORY_SLICES` | 否 | 注入 LLM 的历史轮数，默认 6 |

### 完整 .env 模板

```bash
# LLM（必选其一）
LLM_PROVIDER=auto
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat

# 天气（可选）
OPENWEATHER_API_KEY=
OPENWEATHER_CITY=Beijing,CN

# TTS（可选）
FISH_AUDIO_API_KEY=
FISH_AUDIO_MODEL=s2-pro
FISH_AUDIO_REFERENCE_ID=

# 安全
API_TOKEN=
PORT=8080

# RAG
RAG_ENABLED=true
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_MODEL=bge-large-zh-v1.5

# 历史
CONTEXT_HISTORY_SLICES=6
```

---

## 3. API 接口文档

### 对话

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/chat` | POST | `{"message":"播放 周杰伦 晴天"}` | `{"ok":true}` — 结果通过 WS 推送 |

**WebSocket `/stream`** 事件流：

| type | payload | 触发时机 |
|------|---------|---------|
| `hello` | `{provider, t}` | WS 连接建立 |
| `user-echo` | `{text, source}` | 用户消息回显 |
| `thinking` | `{source, route}` | LLM 开始推理 |
| `say` | `{text, play, reason, segue, ttsUrl}` | LLM 返回结果 |
| `resolving` | `{keyword}` | 开始解析歌曲 |
| `now-playing` | `{song:{name,artist,url}, segue}` | 歌曲可播放 |
| `now-playing-failed` | `{keyword, error}` | 歌曲解析失败 |
| `error` | `{message}` | 异常 |

### 音乐

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/music/search` | GET | `?q=晴天` | `{q, songs:[{id,name,artist,album}]}` |
| `/api/music/play` | GET | `?keyword=晴天` | `{id,name,artist,url}` |
| `/api/music/lyrics` | GET | `?songId=xxx` | `{lyric}` |
| `/api/music/recommend` | GET | `?songId=xxx` | `{songs:[...]}` |
| `/api/music/refresh` | POST | — | 刷新当前歌曲直链 |

### Radio 连续播放

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/radio/start` | POST | `{"scene":"work"}` | `{ok, status, firstTrack}` |
| `/api/radio/stop` | POST | — | `{ok, summary}` |
| `/api/radio/next` | GET | — | `{ok, track}` |
| `/api/radio/status` | GET | — | `{playing, scene, history}` |

### UPnP

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/upnp/scan` | GET | — | `{ok, devices:[{name,host,uuid}]}` |
| `/api/upnp/push` | POST | `{"deviceUuid","audioUrl"}` | `{ok}` |
| `/api/upnp/play` | POST | `{"deviceUuid"}` | `{ok}` |
| `/api/upnp/pause` | POST | `{"deviceUuid"}` | `{ok}` |
| `/api/upnp/stop` | POST | `{"deviceUuid"}` | `{ok}` |

### 状态 & 管理

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/health` | GET | — | `{ok, llm, context, scheduler, rag, wsClients}` |
| `/api/context` | GET | — | `{now, weather, schedule, rss}` |
| `/api/now` | GET | — | `{song:{name,artist,url}}` |
| `/api/state` | GET | — | `{messageCount, last5}` |
| `/api/state/clear` | POST | — | 清空对话历史 |
| `/api/state/prune` | POST | `{"days":7}` 或 `{"keep":100}` | `{ok, removed}` |
| `/api/messages` | GET | `?limit=50&before=1700000000000` | `{messages, total, hasMore}` |
| `/api/reload` | POST | — | 热重载 persona/memory/schedule |
| `/api/schedule` | GET | — | 定时任务列表 |
| `/api/schedule/trigger/:name` | POST | — | 手动触发定时任务 |
| `/api/settings` | POST | `{"provider":"openai","model":"gpt-4o"}` | 运行时切换 LLM |

### 品味文件

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/profile/read` | GET | `?file=taste` | `{file, content}` |
| `/api/profile/save` | POST | `{"file":"taste","content":"..."}` | `{ok}` |

### RAG

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/rag/index` | POST | — | `{ok, results}` — 重建索引 |
| `/api/rag/search` | GET | `?q=周杰伦&limit=5` | `{query, results}` |
| `/api/rag/status` | GET | — | `{indexedFiles, vectorCount}` |

### RSS

| 端点 | 方法 | 请求 | 响应 |
|------|------|------|------|
| `/api/rss/refresh` | POST | — | `{ok, count}` |

### 鉴权

设置 `API_TOKEN` 后，所有 `/api/*` 请求需带 `Authorization: Bearer <token>`。WebSocket 通过查询参数 `?token=<token>` 鉴权。

---

## 4. 前端 SPA 实现

前端是单页 PWA 应用，位于 `public/`：

| 文件 | 说明 |
|------|------|
| `index.html` | 侧边栏 + 对话区布局 |
| `style.css` | 深色主题，响应式适配 |
| `app.js` | WebSocket 管理、消息渲染、播放器控制 |
| `sw.js` | Service Worker（离线缓存） |
| `manifest.webmanifest` | PWA 清单 |

**核心交互流程**：

```
用户输入 → POST /api/chat → WS /stream 监听
  ├─ hello → 连接确认
  ├─ user-echo → 回显消息到聊天区
  ├─ thinking → 显示推理动画
  ├─ say → 渲染文本 + 触发播放
  ├─ resolving / now-playing → 播放器 UI 更新
  └─ error → 显示错误提示
```

**特性**：
- WebSocket 心跳保活（25s ping 间隔）
- 对话历史持久化（localStorage + /api/messages 分页加载）
- 播放器支持进度条、音量、暂停/继续
- PWA 可安装到桌面，离线可用

---

## 5. 错误处理策略

### 全局异常捕获

server.js 各层均有 try-catch 包裹，异常被捕获后通过 WS 广播 `{type:'error', message}` 给前端：

```javascript
// runChat 最外层
try {
  // LLM 调用 + context 聚合 + TTS
} catch (e) {
  broadcast({ type: 'error', message: e.message });
} finally {
  chatBusy = false;
}
```

### 各层降级策略

| 层级 | 失败场景 | 降级行为 |
|------|---------|---------|
| LLM | provider 不可用 | Ollama 本地降级（需启用 `OLLAMA_FALLBACK`） |
| LLM | 单次请求失败 | 指数退避重试（`LLM_MAX_RETRIES` 控制） |
| TTS | Fish Audio 不可用 | 静默降级，前端用浏览器 Web Speech API |
| 天气 | API 超时/无 Key | 仅注入时间，模块自动 disable |
| 飞书 | API 失败 | 降级到本地 JSON 骨架 |
| RSS | 抓取失败 | 跳过资讯片段，不阻塞聊天 |
| RAG | embedding 失败 | RAG 上下文为空，不影响 LLM 推理 |
| 音乐 | 网易云搜索无结果 | 广播 `now-playing-failed`，前端提示 |
| 音乐 | 直链过期 | 自动刷新 URL |

### 并发控制

`chatBusy` 全局锁确保同一时间只有一条对话在处理：

```javascript
if (chatBusy) return res.status(429).json({ error: 'busy' });
chatBusy = true;
// ... 处理 ...
chatBusy = false;
```

### 离线降级链

```
openai → Claude CLI → Ollama(fallback) → mock
```

当 `OLLAMA_FALLBACK=true` 时，主 LLM 不可用会自动切换 Ollama 本地模型。

---

## 6. 性能要求

### 运行环境

| 项目 | 最低要求 | 推荐 |
|------|---------|------|
| Node.js | ≥ 20.0.0 | 22 LTS |
| 内存 | 256 MB | 512 MB（启用 RAG + Ollama 需 2 GB+） |
| 存储 | 50 MB | 200 MB（含 RAG 向量索引 + TTS 缓存） |
| 操作系统 | Windows / macOS / Linux | — |

### 依赖包

```json
{
  "express": "^4.21.0",       // HTTP 框架, ~2 MB
  "ws": "^8.18.0",            // WebSocket, ~1 MB
  "NeteaseCloudMusicApi": "^4.32.0", // 网易云 API, ~5 MB
  "node-cron": "^4.2.1",      // 定时任务, ~500 KB
  "openai": "^6.38.0"         // OpenAI SDK, ~3 MB
}
```

总计安装后约 15-20 MB（不含 Ollama 模型，Ollama 模型通常 2-8 GB 需单独存放）。

### 运行时资源

| 组件 | CPU | 内存 |
|------|-----|------|
| server.js | 极低（事件循环） | ~50 MB |
| RAG 向量索引 | 低（仅检索时） | ~10 MB |
| Ollama 本地模型 | 推理时较高 | 2-8 GB（模型本身） |

---

## 7. 扩展指南

### 添加新 Context 模块

Context 模块负责收集某类环境信息，注入 system prompt。以天气模块为例：

**Step 1**：创建 `lib/context/mycontext.js`

```javascript
let enabled = false;

export function init() {
  enabled = !!process.env.MY_API_KEY;
}

export function enabled() { return enabled; }

export async function getData() {
  // 调用你的 API，返回结构化数据
  const res = await fetch(`https://api.example.com/data`, {
    headers: { Authorization: `Bearer ${process.env.MY_API_KEY}` }
  });
  return res.json();
}

export function toPromptFragment(data) {
  // 将数据转为自然语言片段
  return `我的数据: ${data.summary}`;
}

export function info() {
  return { ready: enabled, configured: !!process.env.MY_API_KEY };
}
```

**Step 2**：在 `server.js` 中注册

```javascript
import * as myContext from './lib/context/mycontext.js';

// collectContext() 中添加
async function collectContext(userMessage) {
  // ... existing code ...
  if (myContext.enabled()) {
    try { out.myData = await myContext.getData(); }
    catch (e) { out.myDataError = e.message; }
  }
  return out;
}

// prompt-builder 中注入
// 在 buildSystemPrompt() 的 envParts 中添加
if (ctx.myData) envParts.push(myContext.toPromptFragment(ctx.myData));

// /api/health 中添加状态
context: { ..., myContext: myContext.info() }
```

**Step 3**：在 `.env.example` 添加配置项

```bash
MY_API_KEY=
```

### 添加新 LLM Provider

实现 `lib/llm/yourprovider.js`，导出两个函数：

```javascript
export async function ask({ userMessage, systemPrompt, historyMessages, timeoutMs }) {
  // 调你的 LLM，返回 {say, play, reason, segue, _meta}
}

export async function info() {
  return { provider: 'yourprovider', ready: true, detail: {} };
}
```

在 `lib/llm/index.js` 的 `ADAPTERS` 中注册：

```javascript
import * as yourProvider from './yourprovider.js';
const ADAPTERS = { ..., yourprovider: yourProvider };
```

然后用 `LLM_PROVIDER=yourprovider npm start` 即可切换。

### 添加新路由规则

编辑 `lib/router.js`，添加匹配模式：

```javascript
const MY_PATTERN = /^我的指令\s*(.+)$/i;

export function route({ message, source, scheduledFragment }) {
  // ... existing code ...
  const matched = m.match(MY_PATTERN);
  if (matched?.[1]) {
    return { mode: 'my-mode', keyword: matched[1].trim(), reason: 'custom' };
  }
  return { mode: 'llm', reason: 'default' };
}
```

在 `runChat()` 中处理新的 mode：

```javascript
if (route.mode === 'my-mode') {
  await emitSay({ say: `处理自定义指令: ${route.keyword}`, source });
  return { ok: true };
}
```

---

## 目录结构

```
claudio/
├── server.js                 # Express + WS 主进程
├── lib/
│   ├── llm/                  # LLM 适配器（claude/openai/ollama/mock）
│   ├── context/              # 环境注入模块（天气/飞书/RSS/品味/记忆/历史）
│   ├── music/                # 音乐播放（网易云/本地降级/UPnP）
│   ├── import/               # 网易云数据导入（登录/分析/写入）
│   ├── tts/                  # Fish Audio TTS
│   ├── rag/                  # RAG 向量记忆（嵌入/检索/索引）
│   ├── router.js             # 点歌指令分流
│   ├── auth.js               # API Token 鉴权
│   ├── radio.js              # Radio 连续播放
│   ├── scheduler.js          # Cron 定时任务
│   ├── state.js              # 状态持久化
│   ├── persona.js            # 人设加载
│   ├── prompt-builder.js     # System Prompt 组装
│   ├── db.js                 # SQLite 数据库（规划中）
│   └── logger.js             # 日志
├── prompts/                  # 人设/品味/记忆模板
├── public/                   # PWA 前端（SPA）
├── scripts/                  # CLI 工具
├── docs/                     # 文档 + 架构可视化
├── test/                     # 单元测试
├── data/                     # 示例数据
├── music/                    # 本地 mp3 曲库
└── state/                    # 运行时持久化（.gitignore）
```

---

## 维护命令

```bash
npm start              # 启动服务
npm test               # 运行单元测试
npm run regression     # 回归测试
npm run prune-state    # 清理 state.json 调试消息
npm run import-ncm     # 从网易云导入听歌数据
```

---

## 架构可视化

打开 [docs/claudio-api-visualization.html](docs/claudio-api-visualization.html) 查看完整的 API 端点 → 核心模块 → 外部依赖的交互式架构图。

特性：
- 80+ 条连线展示数据流和依赖关系
- Hover 节点 → 上下游联动高亮
- 点击节点 → 持久高亮 + 平滑跳转
- 水平滚动吸附 + 键盘 ← → 导航
- 粘性列标题 + 视差背景
- 入场动画 + 粒子流动

---

## 许可

MIT