import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createUser } from '../lib/accounts.js';
import { applyEvent, signPayload, validateEvent, verifySignature } from '../lib/billing.js';
import { getDb } from '../lib/db.js';

const email = `billing-${randomUUID()}@example.com`;
const user = createUser(email, 'billing-password');
const eventIds = [];

after(() => {
  const db = getDb();
  for (const eventId of eventIds) db.prepare('DELETE FROM billing_events WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
});

describe('billing webhook foundation', () => {
  it('signs and verifies raw webhook payloads', () => {
    const raw = Buffer.from('{"id":"evt-1"}');
    const signature = signPayload(raw, 'test-secret');
    assert.equal(verifySignature(raw, signature, 'test-secret'), true);
    assert.equal(verifySignature(Buffer.from('changed'), signature, 'test-secret'), false);
  });

  it('rejects unsupported events and mismatched plans', () => {
    assert.throws(() => validateEvent({ id: 'x', type: 'unknown', userId: user.id, plan: 'pro' }));
    assert.throws(() => validateEvent({
      id: 'x',
      type: 'subscription.cancelled',
      userId: user.id,
      plan: 'pro',
    }));
  });

  it('applies plan changes once using event idempotency', () => {
    const activeId = `evt-${randomUUID()}`;
    const cancelledId = `evt-${randomUUID()}`;
    eventIds.push(activeId, cancelledId);

    const active = applyEvent({
      id: activeId,
      type: 'subscription.active',
      userId: user.id,
      plan: 'pro',
    });
    assert.equal(active.user.plan, 'pro');
    assert.equal(applyEvent({
      id: activeId,
      type: 'subscription.active',
      userId: user.id,
      plan: 'pro',
    }).duplicate, true);

    const cancelled = applyEvent({
      id: cancelledId,
      type: 'subscription.cancelled',
      userId: user.id,
      plan: 'free',
    });
    assert.equal(cancelled.user.plan, 'free');
  });
});
