# 飞书日程集成方案（草案）

> 版本：v0.1 草案  
> 日期：2026-05-27  
> 目标：将 Claudio 的日程上下文从「本地 JSON 文件」升级为「飞书 Open API 实时拉取」

---

## 1. 现状

当前 `lib/context/feishu.js` 从本地 `data/feishu-schedule.json` 读取日程，为 LLM 提供 `今日日程` 上下文。

**局限**：需手动维护 JSON，无法感知实时变更。

---

## 2. 飞书 Open API 鉴权方案

### 2.1 应用类型选择

| 类型 | 适用场景 | 推荐 |
|------|----------|--------|
| 自建应用（企业自建） | 个人/企业内部使用 | **推荐** |
| 商店应用 | 对外发布 | 不适用 |

**结论**：使用**企业自建应用**，在飞书开放平台创建。

### 2.2 鉴权流程（App Access Token）

飞书 Open API v3 使用 `App ID` + `App Secret` 换取 `app_access_token`，再用它换取 `tenant_access_token`（租户令牌），后续 API 调用均使用 `tenant_access_token`。

```
App ID + App Secret
  → POST /open-apis/auth/v3/app_access_token
  → app_access_token
  → POST /open-apis/auth/v3/tenant_access_token
  → tenant_access_token（有效期 2 小时）
```

**关键端点**：

| 端点 | 用途 |
|------|------|
| `POST /open-apis/auth/v3/app_access_token` | 获取 app_access_token |
| `POST /open-apis/auth/v3/tenant_access_token` | 获取 tenant_access_token |
| `GET /open-apis/calendar/v4/calendars` | 列出日历列表 |
| `GET /open-apis/calendar/v4/calendars/:calendar_id/events` | 获取日历事件 |

### 2.3 所需权限（应用后台配置）

在飞书开放平台 → 应用 → 权限管理中勾选：

| 权限 Scope | 说明 |
|-----------|------|
| `calendar:calendar` | 查看日历列表 |
| `calendar:calendar.event` | 查看日历事件 |
| `calendar:calendar.event:readonly` | 只读事件（推荐） |

### 2.4 环境变量设计

```bash
# 飞书 Open API
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_CALENDAR_ID=xxxxxxxxxxxxxxxx  # 可选，默认取主日历

# token 缓存（自动管理，无需手动配置）
# tenant_access_token 缓存在 state/feishu-token.json
```

---

## 3. 实现方案

### 3.1 新增 `lib/context/feishu-api.js`

```
feishu-api.js
├── getTenantAccessToken()    // 带缓存，自动刷新
├── getCalendars()           // 列出日历
├── getTodayEvents(calendarId) // 获取今日事件
└── clearTokenCache()        // 清除缓存（/api/reload 时调用）
```

**Token 缓存策略**：
- 缓存到 `state/feishu-token.json`（含 `token` + `expiresAt`）
- 每次调用前检查是否过期（提前 5 分钟刷新）
- 若刷新失败，广播 `feishu-auth-failed` 事件，降级为本地 JSON

### 3.2 修改 `lib/context/feishu.js`

保持现有接口不变，内部根据环境变量切换数据源：

```javascript
// feishu.js（伪代码）
import * as api from './feishu-api.js';

export async function getTodayEvents() {
  if (process.env.FEISHU_APP_ID) {
    try {
      return await api.getTodayEvents();
    } catch (e) {
      console.warn('[feishu] API 失败，降级本地 JSON:', e.message);
      // 降级到本地文件
    }
  }
  // 原有本地 JSON 逻辑
  return readLocalSchedule();
}
```

### 3.3 API 调用示例

```javascript
// 获取 tenant_access_token
const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    app_id: process.env.FEISHU_APP_ID,
    app_secret: process.env.FEISHU_APP_SECRET,
  }),
});
const { tenant_access_token } = await tokenResp.json();

// 获取今日事件
const today = new Date().toISOString().slice(0, 10);
const eventsResp = await fetch(
  `https://open.feishu.cn/open-apis/calendar/v4/calendars/${calendarId}/events?start_time=${today}T00:00:00+08:00&end_time=${today}T23:59:59+08:00`,
  { headers: { Authorization: `Bearer ${tenant_access_token}` } }
);
```

---

## 4. 前端变更

无需变更。日程信息通过已有的 `/api/context` 和 `scheduled` 事件推送，前端无感知。

---

## 5. 错误处理与降级

| 场景 | 处理方式 |
|------|---------|
| App ID/Secret 错误 | 广播 `feishu-auth-failed`，降级本地 JSON |
| 网络超时 | 重试 1 次，仍失败则降级 |
| Token 过期 | 自动刷新（缓存策略保证） |
| 日历 ID 不存在 | 列出可用日历供用户选择 |

---

## 6. 实施步骤

1. [ ] 在飞书开放平台创建自建应用
3. [ ] 配置权限：`calendar:calendar.event:readonly`
4. [ ] 获取 App ID + App Secret，填入 `.env`
5. [ ] 实现 `lib/context/feishu-api.js`
6. [ ] 修改 `lib/context/feishu.js` 支持双数据源
7. [ ] 添加 `/api/feishu/calendars` 端点（调试用）
8. [ ] 编写单元测试
9. [ ] 更新 README 飞书集成章节

---

## 7. 参考资料

- [飞书开放平台 - 日历 API](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-overview)
- [飞书开放平台 - 鉴权](https://open.feishu.cn/document/server-docs/api-call-guide/calling-process/access-token/tenant_access_token)
- [日历 API 示例](https://open.feishu.cn/document/server-docs/calendar-v4/event/list)
