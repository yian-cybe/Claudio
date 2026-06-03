import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const API_KEY = process.env.FISH_AUDIO_API_KEY;
const MODEL = process.env.FISH_AUDIO_MODEL || 's2-pro';
const REFERENCE_ID = process.env.FISH_AUDIO_REFERENCE_ID || null;
const CACHE_DIR = resolve('state/tts-cache');

export function enabled() {
  return !!API_KEY;
}

export function info() {
  return {
    enabled: enabled(),
    model: MODEL,
    hasReference: !!REFERENCE_ID,
    cacheDir: 'state/tts-cache',
  };
}

function cacheKey(text) {
  const h = createHash('sha256').update(`${MODEL}|${REFERENCE_ID || ''}|${text}`).digest('hex').slice(0, 16);
  return `${h}.mp3`;
}

export async function synthesizeUrl(text) {
  if (!enabled() || !text?.trim()) return null;

  const key = cacheKey(text);
  const filePath = resolve(CACHE_DIR, key);
  const publicUrl = `/tts-cache/${key}`;

  try {
    await access(filePath);
    return publicUrl;
  } catch {}

  const body = {
    text: text.trim(),
    format: 'mp3',
    sample_rate: 44100,
    mp3_bitrate: 128,
    latency: 'normal',
  };
  if (REFERENCE_ID) body.reference_id = REFERENCE_ID;

  const resp = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      model: MODEL,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Fish TTS ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(filePath, buf);

  return publicUrl;
}
