/**
 * RSS 上下文注入 — 拉取新闻/博客标题和摘要，注入 system prompt
 *
 * - 内置默认中文 RSS 源（环境变量 RSS_SOURCES 可覆盖）
 * - 缓存到 state/rss-cache.json，30 分钟内不重复拉取
 * - 拉取失败不影响主流程，降级使用旧缓存
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const CACHE_PATH = resolve('state/rss-cache.json');
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟
const FETCH_TIMEOUT_MS = 10000; // 单源 10s 超时
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 最近 24 小时

const DEFAULT_SOURCES = [
  'https://sspai.com/feed',
  'https://www.guokr.com/rss/',
  'https://36kr.com/feed',
  'https://www.zhihu.com/rss',
];

// ── 缓存状态 ──────────────────────────────────────────
let cache = null; // { items: [...], lastFetch: 'ISO' }
let cacheAt = 0;
let inflight = null;

// ── 配置 ──────────────────────────────────────────────

export function enabled() {
  return process.env.RSS_ENABLED === 'true';
}

export function info() {
  return {
    enabled: enabled(),
    sources: getSources(),
    lastFetch: cache ? cache.lastFetch : null,
    cacheAgeMs: cacheAt ? Date.now() - cacheAt : null,
    itemCount: cache?.items?.length || 0,
  };
}

function getSources() {
  const env = process.env.RSS_SOURCES;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_SOURCES;
}

function getMaxItems() {
  return Math.max(1, Number(process.env.RSS_MAX_ITEMS) || 5);
}

// ── 公共 API ──────────────────────────────────────────

/**
 * 获取 RSS 条目（带缓存）。无网络时返回旧缓存。
 */
export async function getRssItems({ force = false } = {}) {
  if (!enabled()) return [];
  if (!force && cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache.items;
  if (inflight) return inflight;

  inflight = refreshFeeds().then((items) => {
    inflight = null;
    return items;
  }).catch((e) => {
    inflight = null;
    console.warn('[rss] fetch failed, using stale cache:', e.message);
    if (cache) return cache.items;
    throw e;
  });
  return inflight;
}

/**
 * 强制刷新 RSS，忽略缓存。
 */
export async function refreshFeeds() {
  const sources = getSources();
  const items = await fetchFeeds(sources);

  cache = {
    items,
    lastFetch: new Date().toISOString(),
    sources,
  };
  cacheAt = Date.now();
  await saveCache(cache);

  console.log(`[rss] fetched ${items.length} items from ${sources.length} sources`);
  return items;
}

/**
 * 将条目格式化为 system prompt 片段。
 */
export function toPromptFragment(items, maxItems) {
  if (!items || items.length === 0) return '';
  const MAX = Math.min(items.length, maxItems || getMaxItems());
  const lines = ['今日资讯'];
  for (let i = 0; i < MAX; i++) {
    const item = items[i];
    const cat = sourceToCategory(item.source);
    const desc = item.summary
      ? `- [${cat}] ${item.title}：${truncate(item.summary, 60)}`
      : `- [${cat}] ${item.title}`;
    lines.push(desc);
  }
  return lines.join('\n');
}

// ── 缓存持久化 ────────────────────────────────────────

async function loadCache() {
  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.items && data.lastFetch) {
      cache = data;
      cacheAt = new Date(data.lastFetch).getTime();
      return cache;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[rss] cache read error:', e.message);
  }
  return null;
}

async function saveCache(data) {
  try {
    await mkdir(dirname(CACHE_PATH), { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('[rss] cache write error:', e.message);
  }
}

// ── Feed 抓取 & 解析 ──────────────────────────────────

/**
 * 并发拉取多个 RSS 源，过滤最近 24 小时条目，按时间倒序排列。
 */
async function fetchFeeds(urls) {
  const results = await Promise.allSettled(
    urls.map((url) => fetchFeed(url))
  );

  const allItems = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      allItems.push(...result.value);
    }
  }

  // 过滤最近 24 小时
  const cutoff = Date.now() - MAX_AGE_MS;
  const filtered = allItems.filter((item) => {
    if (!item.pubDate) return true; // 无日期不过滤
    const t = new Date(item.pubDate).getTime();
    return t >= cutoff;
  });

  // 按时间倒序
  filtered.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  return filtered;
}

async function fetchFeed(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: ac.signal });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const xml = await resp.text();
    return parseFeed(xml, url);
  } catch (e) {
    console.warn(`[rss] fetch ${url} failed:`, e.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析 RSS/Atom XML，自动检测格式。
 */
function parseFeed(xml, sourceUrl) {
  // 检测 Atom
  if (/<feed\b/i.test(xml) || /xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/i.test(xml)) {
    return parseAtom(xml, sourceUrl);
  }
  return parseRSS(xml, sourceUrl);
}

function parseRSS(xml, sourceUrl) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const summary = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');
    if (title) {
      items.push({ title, link, summary, source: sourceUrl, pubDate });
    }
  }
  return items;
}

function parseAtom(xml, sourceUrl) {
  const items = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractLinkHref(block);
    const summary = extractTag(block, 'summary');
    const pubDate = extractTag(block, 'updated') || extractTag(block, 'published');
    if (title) {
      items.push({ title, link, summary, source: sourceUrl, pubDate });
    }
  }
  return items;
}

// ── XML 工具 ───────────────────────────────────────────

function extractTag(block, tag) {
  // 匹配 <tag>...</tag> 或 <tag attrs>...</tag>，支持 CDATA
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    'i'
  );
  const m = block.match(re);
  if (!m) return '';
  return decodeEntities(m[1].trim());
}

function extractLinkHref(block) {
  const re = /<link[^>]*href="([^"]*)"/i;
  const m = block.match(re);
  return m ? m[1] : '';
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'");
}

// ── 分类 ──────────────────────────────────────────────

function sourceToCategory(url) {
  try {
    const host = new URL(url).hostname;
    const map = {
      'sspai.com': '科技',
      'guokr.com': '科普',
      '36kr.com': '商业',
      'zhihu.com': '综合',
    };
    for (const [key, val] of Object.entries(map)) {
      if (host.includes(key)) return val;
    }
    // 从域名提取标识
    const parts = host.split('.');
    if (parts.length >= 2) return parts[parts.length - 2];
    return '资讯';
  } catch {
    return '资讯';
  }
}

function truncate(str, len) {
  if (!str) return '';
  const cleaned = str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= len) return cleaned;
  return cleaned.slice(0, len) + '…';
}

// ── 启动时加载缓存 ────────────────────────────────────
loadCache().catch(() => {});