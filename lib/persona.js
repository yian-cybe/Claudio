import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let cached = null;
let loadedAt = null;

export function clearCache() {
  cached = null;
  loadedAt = null;
}

export function meta() {
  return { path: 'prompts/persona.md', loadedAt, cached: cached !== null };
}

export async function loadPersona() {
  if (cached !== null) return cached;
  cached = await readFile(resolve('prompts/persona.md'), 'utf8');
  loadedAt = Date.now();
  return cached;
}
