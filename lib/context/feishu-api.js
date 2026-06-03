/**
 * 飞书 Open API 只读拉取今日日程
 *
 * 鉴权: App ID + App Secret → tenant_access_token (缓存到 state/feishu-token.json)
 * 日历: GET /open-apis/calendar/v4/calendars/:id/events
 *
 * 环境变量:
 *   FEISHU_APP_ID          - 飞书应用 App ID
 *   FEISHU_APP_SECRET      - 飞书应用 App Secret
 *   FEISHU_CALENDAR_ID     - 可选，默认取主日历
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const CALENDAR_ID = process.env.FEISHU_CALENDAR_ID || 'primary';

const TOKEN_PATH = resolve('state/feishu-token.json');
const REFRESH_AHEAD_MS = 5 * 60 * 1000; // 提前 5 分钟刷新

export function enabled() {
  return !!(APP_ID && APP_SECRET);
}

export function info() {
  return {
    enabled: enabled(),
    calendarId: CALENDAR_ID,
    tokenCache: TOKEN_PATH,
  };
}

async function loadTokenCache() {
  try {
    const raw = await readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveTokenCache(data) {
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 获取 tenant_access_token，带缓存自动刷新
 * 参考: https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token
 */
async function getTenantAccessToken() {
  // 检查缓存
  const cached = await loadTokenCache();
  if (cached && cached.token && cached.expiresAt) {
    const now = Date.now();
    if (now < cached.expiresAt - REFRESH_AHEAD_MS) {
      return cached.token;
    }
  }

  // 换取新 token
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: APP_ID,
      app_secret: APP_SECRET,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`飞书 token 获取失败 ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const body = await resp.json();
  if (body.code !== 0) {
    throw new Error(`飞书 token 获取失败: code=${body.code} msg=${body.msg || ''}`);
  }

  const data = {
    token: body.tenant_access_token,
    expiresAt: Date.now() + (body.expire || 7200) * 1000,
  };

  await saveTokenCache(data);
  return data.token;
}

/**
 * 列出用户的日历列表
 * 参考: https://open.feishu.cn/document/server-docs/calendar-v4/calendar/list
 */
export async function getCalendars() {
  const token = await getTenantAccessToken();
  const resp = await fetch('https://open.feishu.cn/open-apis/calendar/v4/calendars', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`飞书日历列表获取失败 ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const body = await resp.json();
  if (body.code !== 0) {
    throw new Error(`飞书日历列表获取失败: code=${body.code} msg=${body.msg || ''}`);
  }

  return (body.data?.calendar_list || []).map((c) => ({
    id: c.calendar?.calendar_id || c.calendar_id,
    summary: c.calendar?.summary || c.summary || '',
    type: c.calendar?.type || c.type || '',
  }));
}

/**
 * 获取指定日历的今日事件
 * 参考: https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/list
 */
export async function getTodayEvents() {
  const token = await getTenantAccessToken();

  // 今天 00:00:00 ~ 23:59:59 (秒级 Unix)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000 - 1);

  const startTime = String(Math.floor(startOfDay.getTime() / 1000));
  const endTime = String(Math.floor(endOfDay.getTime() / 1000));

  const calendarId = CALENDAR_ID === 'primary' ? 'primary' : CALENDAR_ID;

  const url = `https://open.feishu.cn/open-apis/calendar/v4/calendars/${calendarId}/events`
    + `?start_time=${startTime}&end_time=${endTime}&page_size=50`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`飞书日程获取失败 ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const body = await resp.json();
  if (body.code !== 0) {
    throw new Error(`飞书日程获取失败: code=${body.code} msg=${body.msg || ''}`);
  }

  const items = body.data?.items || [];

  // 转换为统一格式
  return items.map((item) => {
    const start = item.event_time?.start_time || item.start_time || '';
    const title = item.summary || item.subject || '';
    return {
      title,
      start,
      end: item.event_time?.end_time || item.end_time || '',
      location: item.location || '',
      description: item.description || '',
    };
  });
}
