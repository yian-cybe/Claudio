# 🎙 Claudio — 个人 AI 电台(骨架)

LLM 当大脑(Claude / OpenAI 兼容 / Mock 三选一)+ Node 中枢 + PWA 前端。

**当前阶段**:跑通「用户输入 → LLM 结构化 JSON → TTS + 网易云播放」闭环,并支持定时播报、环境注入、对话历史、Router 点歌分流。Fish TTS / 飞书 API / UPnP / SQLite 为可选或规划中。

## 前置条件

- Node ≥ 20
- 至少一个 LLM provider 可用(见下方"切换 provider")
- Windows / macOS / Linux 都行

## 启动

```bash
npm install
npm start              # 默认 auto:有 OPENAI_API_KEY 就用 openai,否则 claude
```

打开 http://localhost:8080,输入一句话,几秒后听到回应。

**两周完善计划**见 [`docs/两周计划.md`](docs/两周计划.md)。

## 切换 LLM provider

用 `LLM_PROVIDER` 环境变量指定:

| 值 | 说明 | 关键 env |
|----|------|----------|
| `auto`(默认) | 有 `OPENAI_API_KEY` 走 openai,否则走 claude | — |
| `claude` | spawn `claude` CLI 子进程,适合 Max 订阅 | `CLAUDE_MODEL`(默认 `claude-opus-4-7[1m]`)<br>`CLAUDE_CODE_GIT_BASH_PATH`(Win 自动探测) |
| `openai` | 调 OpenAI 兼容协议(OpenAI / DeepSeek / 通义 / Kimi 都行) | `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` |
| `mock` | 不调真 LLM,返回随机样例 | — |

**`CLAUDIO_MOCK=1` 是 `LLM_PROVIDER=mock` 的快捷别名。**

### 常见配置示例(bash)

```bash
# Claude(默认中转商或 Max 订阅)
LLM_PROVIDER=claude npm start

# OpenAI 官方
LLM_PROVIDER=openai OPENAI_API_KEY=sk-xxx OPENAI_MODEL=gpt-4o-mini npm start

# DeepSeek
LLM_PROVIDER=openai \
  OPENAI_API_KEY=sk-xxx \
  OPENAI_BASE_URL=https://api.deepseek.com/v1 \
  OPENAI_MODEL=deepseek-chat \
  npm start

# 通义千问(阿里云)
LLM_PROVIDER=openai \
  OPENAI_API_KEY=sk-xxx \
  OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 \
  OPENAI_MODEL=qwen-plus \
  npm start

# Kimi(月之暗面)
LLM_PROVIDER=openai \
  OPENAI_API_KEY=sk-xxx \
  OPENAI_BASE_URL=https://api.moonshot.cn/v1 \
  OPENAI_MODEL=moonshot-v1-8k \
  npm start

# Mock(中转商挂了 / 想先看 UI)
CLAUDIO_MOCK=1 npm start
```

Windows PowerShell 用 `$env:VAR=...;`,cmd 用 `set VAR=... && ...`。

## 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST `{message}` | 触发 LLM 调用,结果通过 WS 推 |
| `/api/now` | GET | 当前正在播放的歌曲 |
| `/api/context` | GET | 当前环境(时间 + 天气,有 key 时启用) |
| `/api/health` | GET | 健康检查 + 当前 provider + context 模块状态 |
| `/api/messages` | GET `?limit=50&before=ts` | 可展示的消息列表(分页) |
| `/api/state/clear` | POST | 清空对话历史 |
| `/api/state/prune` | POST `{days/keep}` | 裁剪对话历史 |
| `/api/reload` | POST | 热重载 `persona.md` / `memory.md` / `schedule.json` |
| `/api/state` | GET | 消息计数 + 最后 5 条(调试用) |
| `/stream` | WS | server → 前端事件流(`hello/thinking/say/error`) |

`say` 事件携带 `{text, play, reason, segue, meta}`。

## 目录

```
claudio/
├── server.js                # Express + WS
├── lib/
│   ├── llm/                 # claude / openai / mock + 多轮 history
│   ├── context/
│   │   ├── weather.js       # OpenWeather
│   │   ├── history.js       # 近期对话切片
│   │   ├── memory.js        # prompts/memory.md
│   │   ├── taste.js         # USER 品味上下文（4 文件组装）
│   │   └── feishu.js        # 飞书日程（API + 本地 JSON 双模式）
│   ├── music/
│   │   ├── ncm.js           # 网易云搜歌 + 直链
│   │   └── local.js         # 本地 mp3 降级（离线兜底）
│   ├── import/
│   │   ├── ncm.js           # 网易云数据导入（登录 + 拉取）
│   │   ├── analyzer.js      # 听歌数据聚合分析
│   │   └── writer.js        # 品味文件写入器
│   ├── tts/fish.js          # Fish Audio(可选)
│   ├── router.js            # 点歌指令分流
│   ├── auth.js              # API_TOKEN 中间件
│   ├── scheduler.js         # cron 定时
│   ├── state.js
│   ├── persona.js
│   └── prompt-builder.js    # Prompt 组装器
├── prompts/persona.md
├── prompts/memory.md        # 长期记忆(可选)
├── prompts/taste.md         # 音乐品味档案
├── prompts/routines.md      # 日常节奏表
├── prompts/playlists.json   # 歌单索引
├── prompts/mood-notes.json  # 近期心情日志
├── data/feishu-schedule.example.json
├── music/                   # 本地 mp3 曲库（放入 .mp3 文件即可离线播放）
├── public/                  # PWA(Player 单视图)
├── state/
│   ├── state.json         # 运行时持久化(.gitignore)
│   └── backups/           # 品味文件导入前自动备份
```

## Context 注入

每次 chat,server 会在 system prompt 末尾追加一段「当前环境」:

```
# 当前环境
现在 2026/5/21 11:30:00
天气 北京 多云 18°C · 体感 16°C · 湿度 55%
```

天气需配置 `OPENWEATHER_API_KEY`(去 https://openweathermap.org/api 注册免费 key,10 分钟内存缓存,接口失败不阻塞 chat)。无 key 时只注入时间,模块自动 disable。

后续接「飞书日程」「已检索记忆」等也走同样模式 —— 各自一个 `lib/context/*.js`,在 server 的 `collectContext()` 里聚合。

### USER 品味文件体系

项目支持通过四份文件定义用户的音乐品味和日常节奏，LLM 会在每次对话中读取这些信息来个性化推荐。

| 文件 | 说明 | 格式 |
|------|------|------|
| `prompts/taste.md` | 音乐品味档案：喜欢/讨厌的风格、歌手、年代、聆听习惯 | Markdown |
| `prompts/routines.md` | 日常节奏表：按时间段描述状态和音乐需求 | Markdown |
| `prompts/playlists.json` | 歌单索引：name / description / mood / tags | JSON 数组 |
| `prompts/mood-notes.json` | 近期心情日志：date / mood / note / wanted_genre | JSON 数组 |

品味文件由 `lib/context/taste.js` 统一读取并组装为结构化上下文，通过 `lib/prompt-builder.js` 注入 system prompt。

编辑品味文件后调用 `POST /api/reload` 即可热更新，无需重启服务。

Prompt 组装顺序：persona → taste → context（天气/日程）→ memory → scheduled。

## 网易云数据导入

通过 `npm run import-ncm` 可以从网易云音乐自动拉取你的听歌数据，聚合分析后更新品味文件。

**流程**:
1. 手机号登录网易云（首次需输入手机号 + 密码，后续自动恢复会话）
2. 拉取听歌排行（所有时间 + 最近一周）、歌单列表、红心歌曲
3. 聚合分析：TOP 20 高频歌手、风格分布、年代偏好
4. 展示预览，确认后写入品味文件

**写入的文件**:

| 文件 | 策略 |
|------|------|
| `prompts/taste.md` | **覆盖**风格/歌手/年代/讨厌类型（自动生成） |
| `prompts/playlists.json` | **追加**新歌单条目，按 id 去重，保留手动编辑 |
| `prompts/routines.md` | **不修改** |
| `prompts/mood-notes.json` | **不修改** |

写入前原文件自动备份到 `state/backups/`。

```bash
npm run import-ncm
# 或直接:
node scripts/import-ncm.js
```

导入完成后可调用 `POST /api/reload` 热更新品味上下文。

## 定时播报配置 (`prompts/schedule.json`)

系统支持基于 cron 表达式的定时任务。编辑 `prompts/schedule.json`：

```json
[
  { 
    "name": "morning", 
    "cron": "0 7 * * *",  
    "fragment": "现在是早 7 点。主动跟用户说一句温暖的早安,可以结合当前天气。" 
  }
]
```

- **name**: 任务唯一标识，用于日志和手动触发。
- **cron**: 标准 5 位 cron 表达式（分 时 日 月 周）。
- **fragment**: 触发时发送给 LLM 的指令片段。LLM 会根据此片段生成一段回复并通过语音播放。

修改后可调用 `POST /api/reload` 热更新，无需重启服务。

## 安全建议

- **API Token**: 如果你打算将 Claudio 暴露在公网，请务必在 `.env` 中设置 `API_TOKEN=你的长随机字符串`。设置后，所有 API 请求（包括 WebSocket）都需要校验 Token。
- **本地绑定**: 默认情况下服务监听所有网卡。在生产环境或不需要外网访问时，建议通过 `HOST=127.0.0.1` 环境变量限制仅本地访问。
- **.env 文件**: 严禁将包含真实 Key 的 `.env` 提交到 Git。本项目已默认将其加入 `.gitignore`。
- **HTTPS**: 如果通过公网访问，建议使用 Nginx 反向代理并配置 SSL 证书，以防 Token 在传输过程中被截获。

## 加新 provider

实现一个新文件 `lib/llm/yourprovider.js`,导出两个函数:

```js
export async function ask({ userMessage, systemPrompt, timeoutMs }) {
  // 调你的 LLM,返回 {say, play, reason, segue, _meta}
}
export async function info() {
  return { provider: 'yourprovider', ready: <bool>, detail: {...}, error: '可选' };
}
```

在 `lib/llm/index.js` 的 `ADAPTERS` 里加一行,就能用 `LLM_PROVIDER=yourprovider` 切到了。

## 中转商踩坑记录(走 claude provider 时)

如果环境里 `ANTHROPIC_BASE_URL` 指向第三方中转,可能遇到:

- **`API Error: 503 model_not_found`** — 中转对某 model 没频道。换 `CLAUDE_MODEL` 试试
- **`API Error: 429 Service Unavailable`** — 中转限流。CLI 内部退避重试,可能 3-5 分钟才退
- **`API Error: 400 1m 上下文已经全量可用,请启用 1m 上下文`** — 中转强制要 `[1m]` 后缀

诊断顺序:
1. 终端直接跑 `claude -p "hi" --model claude-opus-4-7[1m]`,先确认中转可用
2. 不可用 → 换 provider(`LLM_PROVIDER=openai` + DeepSeek 国内最稳)或用 mock

## 进阶能力(已实现)

| 能力 | 说明 | 配置 |
|------|------|------|
| 对话历史 | 最近 `CONTEXT_HISTORY_SLICES` 轮用户对话注入 LLM | 默认 6 |
| Router | `播放 xxx` / `点歌 xxx` / `/play xxx` 跳过 LLM 直连网易云 | 无需配置 |
| 长期记忆 | `prompts/memory.md` 拼进 system prompt | 编辑文件即可 |
| 日程(骨架) | `data/feishu-schedule.json` 今日事项 | 复制 example 改名 |
| 定时播报 | `prompts/schedule.json` cron + 触发文案 | 改文件后重启服务 |
| Fish TTS | 配置后 `say` 用 Fish 音频,失败回退浏览器朗读 | `FISH_AUDIO_*` |
| API 鉴权 | 设置 `API_TOKEN` 后 POST `/api/chat` 需 Bearer | 可选 |

点歌示例:`播放 周杰伦 晴天`、`点歌 Norah Jones`

维护命令:

```bash
npm run prune-state   # 从 state.json 删除 scheduled:test 等调试消息
npm run import-ncm    # 从网易云音乐导入听歌数据并更新品味文件
curl -X POST http://127.0.0.1:8080/api/reload   # 热更新人设与记忆
```

Fish TTS 配置见 [`docs/FISH-TTS.md`](docs/FISH-TTS.md)。变更记录见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

## 已知限制 / 后续

- TTS 默认浏览器 Web Speech;Fish 需 API Key 与 `reference_id`(可选)
- 飞书日程目前是本地 JSON 骨架,未接飞书 Open API
- UPnP 推流到局域网音箱未实现
- 状态仍用 JSON 文件,未换 SQLite
- 无向量记忆检索(RAG)
