import cron from 'node-cron';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SCHEDULE_PATH = resolve('prompts/schedule.json');

let registered = []; // [{name, cron, fragment, task, lastTriggeredAt}]

async function loadSchedule() {
  try {
    const raw = await readFile(SCHEDULE_PATH, 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('schedule.json must be array');
    return list;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function start(onTrigger) {
  stop(); // 重启时先清
  const list = await loadSchedule();
  for (const entry of list) {
    if (!entry.name || !entry.cron || !entry.fragment) {
      console.warn(`[scheduler] 跳过非法条目:`, entry);
      continue;
    }
    if (!cron.validate(entry.cron)) {
      console.warn(`[scheduler] 跳过非法 cron 表达式: ${entry.name} → ${entry.cron}`);
      continue;
    }
    const task = cron.schedule(entry.cron, async () => {
      const item = registered.find((r) => r.name === entry.name);
      if (item) item.lastTriggeredAt = Date.now();
      try {
        await onTrigger({ source: `scheduled:${entry.name}`, scheduledFragment: entry.fragment });
      } catch (e) {
        console.error(`[scheduler:${entry.name}] error:`, e.message);
      }
    });
    registered.push({ ...entry, task, lastTriggeredAt: null });
  }
  console.log(`[scheduler] 注册了 ${registered.length} 条计划: ${registered.map((r) => `${r.name}(${r.cron})`).join(', ') || '(无)'}`);
}

export function stop() {
  for (const r of registered) {
    try { r.task?.stop(); } catch {}
  }
  registered = [];
}

export function list() {
  return registered.map(({ name, cron, fragment, lastTriggeredAt }) => ({ name, cron, fragment, lastTriggeredAt }));
}

export function findByName(name) {
  return registered.find((r) => r.name === name) || null;
}
