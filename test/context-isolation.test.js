import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import * as memory from '../lib/context/memory.js';
import * as taste from '../lib/context/taste.js';
import * as ragStore from '../lib/rag/store.js';

const userA = `context-a-${randomUUID()}`;
const userB = `context-b-${randomUUID()}`;

after(() => {
  const db = getDb();
  db.prepare('DELETE FROM user_settings WHERE user_id IN (?, ?)').run(userA, userB);
  try {
    db.prepare('DELETE FROM rag_vectors WHERE user_id IN (?, ?)').run(userA, userB);
  } catch { /* table may not exist */ }
});

describe('per-user context isolation', () => {
  it('keeps long-term memory separated', async () => {
    await memory.append('A likes quiet mornings', userA);
    await memory.append('B likes late-night jazz', userB);
    assert.match(await memory.loadFragment(userA), /quiet mornings/);
    assert.doesNotMatch(await memory.loadFragment(userA), /late-night jazz/);
  });

  it('keeps taste profiles separated', async () => {
    await taste.saveProfile(userA, 'taste', 'ambient only');
    await taste.saveProfile(userB, 'taste', 'rock only');
    assert.equal(await taste.buildFragment(userA), 'ambient only');
    assert.equal(await taste.buildFragment(userB), 'rock only');
  });

  it('creates user-owned RAG storage', () => {
    ragStore.clearIndex(userA);
    const columns = getDb().prepare('PRAGMA table_info(rag_vectors)').all().map((column) => column.name);
    assert.ok(columns.includes('user_id'));
  });
});
