import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  normalizeEmail,
  validateCredentials,
  verifyPassword,
} from '../lib/accounts.js';
import { parseCookies } from '../lib/auth.js';

describe('account credentials', () => {
  it('normalizes email addresses', () => {
    assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  });

  it('rejects invalid credentials', () => {
    assert.throws(() => validateCredentials('not-an-email', 'password'));
    assert.throws(() => validateCredentials('user@example.com', 'short'));
  });

  it('hashes and verifies passwords without storing plaintext', () => {
    const stored = hashPassword('a-secure-password');
    assert.notEqual(stored, 'a-secure-password');
    assert.equal(verifyPassword('a-secure-password', stored), true);
    assert.equal(verifyPassword('wrong-password', stored), false);
  });

  it('parses the session cookie from request headers', () => {
    assert.deepEqual(parseCookies('theme=dark; claudio_session=abc123'), {
      theme: 'dark',
      claudio_session: 'abc123',
    });
  });
});
