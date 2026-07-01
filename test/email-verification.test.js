import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createUser, getUserById } from '../lib/accounts.js';
import { issueToken, verifyToken } from '../lib/email-verification.js';
import { getDb } from '../lib/db.js';

const user = createUser(`verify-${randomUUID()}@example.com`, 'verification-password');

after(() => {
  const db = getDb();
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
});

describe('email verification', () => {
  it('creates new users as unverified', () => {
    assert.equal(user.emailVerified, false);
  });

  it('stores only a token hash and verifies once', () => {
    const issued = issueToken(user.id, 1_000);
    const stored = getDb().prepare(
      'SELECT token_hash FROM email_verification_tokens WHERE user_id = ?'
    ).get(user.id);
    assert.notEqual(stored.token_hash, issued.token);

    const verified = verifyToken(issued.token, 2_000);
    assert.equal(verified.emailVerified, true);
    assert.equal(getUserById(user.id).emailVerified, true);
    assert.throws(() => verifyToken(issued.token, 3_000), /invalid/);
  });

  it('rejects expired tokens', () => {
    const other = createUser(`expired-${randomUUID()}@example.com`, 'verification-password');
    try {
      const issued = issueToken(other.id, 1_000);
      assert.throws(
        () => verifyToken(issued.token, issued.expiresAt.getTime() + 1),
        /expired/
      );
    } finally {
      const db = getDb();
      db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(other.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(other.id);
    }
  });
});
