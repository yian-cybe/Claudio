/**
 * 网易云音乐数据导入模块
 *
 * 封装登录 + 数据拉取 + 聚合分析流水线。
 * 支持 cookie 持久化，避免反复登录。
 */

import ncm from 'NeteaseCloudMusicApi';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const {
  login_cellphone,
  login_status,
  login_refresh,
  user_record,
  user_playlist,
  likelist,
} = ncm;

const COOKIE_PATH = resolve('state/ncm-cookie.json');

// ───────────────── Cookie 管理 ─────────────────

/** 读取缓存的 cookie */
async function loadCookie() {
  try {
    const raw = await readFile(COOKIE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data.cookie && data.uid) return data;
    return null;
  } catch {
    return null;
  }
}

/** 保存 cookie 到磁盘 */
async function saveCookie(cookieStr, uid) {
  await mkdir(resolve('state'), { recursive: true });
  await writeFile(COOKIE_PATH, JSON.stringify({ cookie: cookieStr, uid, savedAt: Date.now() }, null, 2), 'utf8');
}

// ───────────────── 核心 API ─────────────────

/**
 * 手机号登录。返回 { cookie, uid }。
 * 失败时错误信息包含是否需要验证码等提示。
 */
export async function login(phone, password, countrycode = '86') {
  const res = await login_cellphone({ phone, password, countrycode });

  if (res.body?.code === 200) {
    const cookie = typeof res.body.cookie === 'string' ? res.body.cookie : (res.cookie?.join?.(';') || '');
    const uid = res.body.account?.id || res.body.profile?.userId;
    if (cookie && uid) {
      await saveCookie(cookie, uid);
      return { cookie, uid };
    }
    return { error: '登录成功但未获取到 cookie/uid', raw: res.body };
  }

  // 常见错误码处理
  const code = res.body?.code;
  const msg = res.body?.message || res.body?.msg || '';
  if (code === 501) return { error: '需要短信验证码，请稍后在交互界面中输入' };
  if (code === 502) return { error: '需要图形验证码，暂不支持' };
  if (code === 400 || code === -1) return { error: `账号或密码错误: ${msg}` };
  return { error: `登录失败 (${code}): ${msg}`, raw: res.body };
}

/** 检查 cookie 是否仍有效，返回 { valid, uid, profile } */
export async function checkLoginStatus(cookieStr) {
  try {
    const res = await login_status({ cookie: cookieStr });
    if (res.body?.data?.code === 200 || res.body?.code === 200) {
      const profile = res.body?.data?.profile || res.body?.profile || {};
      return { valid: true, uid: profile.userId || profile.id || 0, profile };
    }
    return { valid: false };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/** 尝试用缓存 cookie 恢复登录状态 */
export async function tryRestoreSession() {
  const cached = await loadCookie();
  if (!cached) return null;

  const status = await checkLoginStatus(cached.cookie);
  if (status.valid) {
    return { cookie: cached.cookie, uid: status.uid, profile: status.profile };
  }

  // cookie 过期，尝试 refresh
  try {
    const refreshed = await login_refresh({ cookie: cached.cookie });
    if (refreshed.body?.code === 200) {
      const newCookie = refreshed.body.cookie || refreshed.cookie?.join?.(';') || cached.cookie;
      const uid = cached.uid || status.uid;
      await saveCookie(newCookie, uid);
      const recheck = await checkLoginStatus(newCookie);
      if (recheck.valid) return { cookie: newCookie, uid, profile: recheck.profile };
    }
  } catch { /* refresh 失败，往下走 */ }

  return null;
}

// ───────────────── 数据拉取 ─────────────────

/** 拉取听歌排行 */
export async function fetchUserRecord(cookie, uid) {
  const results = {};

  // 所有时间
  try {
    const r = await user_record({ uid, type: 0, cookie });
    results.allData = r.body?.allData || [];
  } catch (e) {
    results.allData = [];
    results.allError = e.message;
  }

  // 最近一周
  try {
    const r = await user_record({ uid, type: 1, cookie });
    results.weekData = r.body?.weekData || [];
  } catch (e) {
    results.weekData = [];
    results.weekError = e.message;
  }

  return results;
}

/** 拉取用户歌单列表 */
export async function fetchUserPlaylists(cookie, uid) {
  try {
    const r = await user_playlist({ uid, limit: 50, cookie });
    const list = r.body?.playlist || [];
    // 过滤掉系统歌单（如每日推荐、私人 FM）
    return list.filter((p) => p.userId === uid);
  } catch (e) {
    return [];
  }
}

/** 拉取红心歌曲列表 */
export async function fetchLikelist(cookie, uid) {
  try {
    const r = await likelist({ uid, cookie });
    return r.body?.ids || [];
  } catch (e) {
    return [];
  }
}

// ───────────────── 聚合拉取 ─────────────────

/**
 * 一次性拉取全部数据：听歌排行 + 歌单 + 红心歌曲
 */
export async function fetchAll(cookie, uid) {
  const [record, playlists, likelist] = await Promise.all([
    fetchUserRecord(cookie, uid),
    fetchUserPlaylists(cookie, uid),
    fetchLikelist(cookie, uid),
  ]);

  return { record, playlists, likelist };
}