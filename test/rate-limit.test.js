import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientIp,
  consume,
  resetRateLimits,
} from '../lib/rate-limit.js';

beforeEach(() => resetRateLimits());

describe('rate limiter', () => {
  it('allows requests up to the limit and rejects the next request', () => {
    const first = consume({ namespace: 'test', key: 'a', limit: 2, windowMs: 1000, now: 100 });
    const second = consume({ namespace: 'test', key: 'a', limit: 2, windowMs: 1000, now: 200 });
    const third = consume({ namespace: 'test', key: 'a', limit: 2, windowMs: 1000, now: 300 });

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
    assert.equal(third.remaining, 0);
    assert.equal(third.retryAfterSeconds, 1);
  });

  it('isolates keys and resets after the window', () => {
    consume({ namespace: 'test', key: 'a', limit: 1, windowMs: 1000, now: 100 });
    assert.equal(consume({ namespace: 'test', key: 'b', limit: 1, windowMs: 1000, now: 200 }).allowed, true);
    assert.equal(consume({ namespace: 'test', key: 'a', limit: 1, windowMs: 1000, now: 1200 }).allowed, true);
  });

  it('trusts forwarded IP only when explicitly enabled', () => {
    const original = process.env.TRUST_PROXY;
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(req), '127.0.0.1');
    process.env.TRUST_PROXY = 'true';
    assert.equal(clientIp(req), '203.0.113.8');
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });
});
