import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as feishuApi from './feishu-api.js';

const SCHEDULE_PATH = resolve(process.env.FEISHU_SCHEDULE_PATH || 'data/feishu-schedule.json');

// 兜底：本地 JSON 文件
function localEnabled() {
  return existsSync(SCHEDULE_PATH);
}

export function enabled() {
  return feishuApi.enabled() || localEnabled();
}

export function info() {
  const api = feishuApi.enabled();
  const local = localEnabled();
  return {
    enabled: enabled(),
    mode: api ? 'feishu-api' : local ? 'local-json' : 'disabled',
    apiInfo: feishuApi.info(),
    localPath: SCHEDULE_PATH,
    note: api ? '飞书 Open API 实时拉取' : local ? '本地 JSON 日程' : '未配置日程源',
  };
}

async function getLocalEvents() {
  if (!localEnabled()) return [];
  const raw = await readFile(SCHEDULE_PATH, 'utf8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) return [];
  const today = new Date().toLocaleDateString('zh-CN', { hour12: false });
  return list.filter((e) => {
    if (!e?.start) return false;
    const d = new Date(e.start);
    return d.toLocaleDateString('zh-CN', { hour12: false }) === today;
  });
}

export async function getTodayEvents() {
  // 优先飞书 API
  if (feishuApi.enabled()) {
    try {
      const events = await feishuApi.getTodayEvents();
      console.log(`[feishu] API 拉取到 ${events.length} 条今日日程`);
      return events;
    } catch (e) {
      console.warn('[feishu] API 拉取失败，回退本地 JSON:', e.message);
      // 降级到本地 JSON
    }
  }

  // 兜底：本地 JSON
  const events = await getLocalEvents();
  if (events.length) {
    console.log(`[feishu] 本地 JSON 读取到 ${events.length} 条今日日程`);
  }
  return events;
}

export function toPromptFragment(events) {
  if (!events.length) return '今日暂无日程安排';
  const lines = events.map((e) => {
    const t = e.start ? new Date(e.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '??:??';
    return `- ${t} ${e.title || '(无标题)'}`;
  });
  return `今日日程\n${lines.join('\n')}`;
}
