# Changelog

## 2026-05-22

### 已修复
- WebSocket 反复断开重连（客户端重连逻辑 + 服务端心跳）
- LLM 返回空 / 非 JSON（历史污染 `[曾推荐播放]`、自动重试、`ensureSay`）
- 刷新页面后聊天记录丢失（`GET /api/messages`）

### 已新增
- `lib/llm/retry.js`：解析失败自动重试
- `POST /api/state/clear`、`GET /api/messages`
- `POST /api/reload`：热更新 persona / memory / schedule
- `npm run prune-state`：清理 test 消息
- 点歌失败 / 搜歌中主界面提示
- `docs/两周计划.md`
- **安全与历史**:
  - WebSocket Token 校验 (`?token=`)
  - 前端支持 API_TOKEN 自动注入 (Bearer / Query)
  - 历史消息分页加载与「加载更多」按钮
  - `POST /api/state/prune` 按天/按条数裁剪历史
