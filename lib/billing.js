import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.js';
import { setUserPlan } from './accounts.js';

const EVENT_TYPES = new Set(['subscription.active', 'subscription.cancelled']);

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

export function enabled() {
  return !!process.env.BILLING_WEBHOOK_SECRET;
}

export function signPayload(rawBody, secret = process.env.BILLING_WEBHOOK_SECRET) {
  if (!secret) throw new Error('billing webhook secret not configured');
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(rawBody, signature, secret = process.env.BILLING_WEBHOOK_SECRET) {
  if (!secret || !signature) return false;
  const expected = Buffer.from(signPayload(rawBody, secret), 'hex');
  let actual;
  try {
    actual = Buffer.from(String(signature).replace(/^sha256=/i, ''), 'hex');
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('invalid billing event');
  if (!event.id || typeof event.id !== 'string') throw new Error('billing event id required');
  if (!EVENT_TYPES.has(event.type)) throw new Error('unsupported billing event type');
  if (!event.userId || typeof event.userId !== 'string') throw new Error('billing user id required');
  const expectedPlan = event.type === 'subscription.active' ? 'pro' : 'free';
  if (event.plan !== expectedPlan) throw new Error('billing event plan does not match event type');
  return { id: event.id, type: event.type, userId: event.userId, plan: event.plan };
}

export function applyEvent(input) {
  const event = validateEvent(input);
  const db = ensureTable();
  if (db.prepare('SELECT event_id FROM billing_events WHERE event_id = ?').get(event.id)) {
    return { ok: true, duplicate: true, event };
  }

  db.exec('BEGIN');
  try {
    const user = setUserPlan(event.userId, event.plan);
    db.prepare(`
      INSERT INTO billing_events (event_id, event_type, user_id, plan)
      VALUES (?, ?, ?, ?)
    `).run(event.id, event.type, event.userId, event.plan);
    db.exec('COMMIT');
    return { ok: true, duplicate: false, event, user };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

