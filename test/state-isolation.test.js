import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import * as state from '../lib/state.js';

const userA = `test-a-${randomUUID()}`;
const userB = `test-b-${randomUUID()}`;

after(() => {
  const db = getDb();
  db.prepare('DELETE FROM history WHERE user_id IN (?, ?)').run(userA, userB);
  db.prepare('DELETE FROM user_settings WHERE user_id IN (?, ?)').run(userA, userB);
});

describe('per-user state isolation', () => {
  it('keeps message history separated by owner', async () => {
    await state.appendMessage({ role: 'user', content: 'only-a', source: 'user' }, userA);
    await state.appendMessage({ role: 'user', content: 'only-b', source: 'user' }, userB);

    const a = await state.load(userA);
    const b = await state.load(userB);
    assert.deepEqual(a.messages.map((message) => message.content), ['only-a']);
    assert.deepEqual(b.messages.map((message) => message.content), ['only-b']);
  });

  it('clears only the requested owner history', async () => {
    await state.clearMessages(userA);
    assert.equal((await state.load(userA)).messages.length, 0);
    assert.deepEqual((await state.load(userB)).messages.map((message) => message.content), ['only-b']);
  });

  it('keeps playback state separated by owner', async () => {
    await state.setNowPlaying({ keyword: 'song-a' }, userA);
    await state.setNowPlaying({ keyword: 'song-b' }, userB);
    assert.equal((await state.load(userA)).nowPlaying.keyword, 'song-a');
    assert.equal((await state.load(userB)).nowPlaying.keyword, 'song-b');
  });
});
