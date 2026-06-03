// OpenWeather Current Weather Data
// 无 OPENWEATHER_API_KEY 时整模块 disable,getWeather() 返回 null
// 10 分钟内存缓存,避免每次 chat 都打外网

const API_KEY = process.env.OPENWEATHER_API_KEY;
const CITY = process.env.OPENWEATHER_CITY || 'Beijing,CN';
const LANG = process.env.OPENWEATHER_LANG || 'zh_cn';
const UNITS = process.env.OPENWEATHER_UNITS || 'metric';

const CACHE_MS = 10 * 60 * 1000;
let cache = null;
let cacheAt = 0;
let inflight = null;

export function enabled() {
  return !!API_KEY;
}

export function info() {
  return {
    enabled: enabled(),
    city: CITY,
    lang: LANG,
    units: UNITS,
    hasKey: !!API_KEY,
    cacheAgeMs: cacheAt ? Date.now() - cacheAt : null,
  };
}

export async function getWeather({ force = false } = {}) {
  if (!enabled()) return null;
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  if (inflight) return inflight;

  inflight = fetchWeather().then((data) => {
    cache = data;
    cacheAt = Date.now();
    inflight = null;
    return data;
  }).catch((e) => {
    inflight = null;
    if (cache) return cache; // 失败时还能用旧缓存
    throw e;
  });
  return inflight;
}

async function fetchWeather() {
  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  url.searchParams.set('q', CITY);
  url.searchParams.set('appid', API_KEY);
  url.searchParams.set('units', UNITS);
  url.searchParams.set('lang', LANG);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  let resp;
  try {
    resp = await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`OpenWeather ${resp.status}: ${body.slice(0, 200)}`);
  }

  const j = await resp.json();
  return {
    city: j.name,
    country: j.sys?.country,
    temp: Math.round(j.main?.temp),
    feelsLike: Math.round(j.main?.feels_like),
    humidity: j.main?.humidity,
    condition: j.weather?.[0]?.description,
    main: j.weather?.[0]?.main,
    wind: j.wind?.speed,
    fetchedAt: new Date().toISOString(),
  };
}

// 给 LLM system prompt 用的紧凑文本片段
export function toPromptFragment(w) {
  if (!w) return '';
  const parts = [`${w.city} ${w.condition} ${w.temp}°C`];
  if (typeof w.feelsLike === 'number' && Math.abs(w.feelsLike - w.temp) >= 2) {
    parts.push(`体感 ${w.feelsLike}°C`);
  }
  if (typeof w.humidity === 'number') parts.push(`湿度 ${w.humidity}%`);
  return parts.join(' · ');
}
