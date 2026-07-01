import * as state from '../state.js';

export const PROFILE_KEYS = ['taste', 'routines', 'playlists', 'mood-notes'];

export function clearCache() {}

export async function readProfile(userId, key) {
  if (!PROFILE_KEYS.includes(key)) throw new Error(`unknown profile '${key}'`);
  return state.getUserSetting(userId, `profile:${key}`, '');
}

export async function saveProfile(userId, key, content) {
  if (!PROFILE_KEYS.includes(key)) throw new Error(`unknown profile '${key}'`);
  return state.setUserSetting(userId, `profile:${key}`, content);
}

export async function buildFragment(userId) {
  const values = await Promise.all(PROFILE_KEYS.map((key) => readProfile(userId, key)));
  return values.filter(Boolean).join('\n\n');
}

export function info() {
  return {
    storage: 'user_settings',
    keys: PROFILE_KEYS.map((key) => `profile:${key}`),
  };
}
