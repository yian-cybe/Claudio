import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createUser, getUserById, setUserPlan } from '../lib/accounts.js';
import { getDb } from '../lib/db.js';
import {
  createPaymentOrder,
  getPaymentOrder,
  markPaymentOrderPaid,
  PRODUCTS,
} from '../lib/payment-orders.js';

const user = createUser(`payment-${randomUUID()}@example.com`, 'payment-password');
const otherUser = createUser(`payment-other-${randomUUID()}@example.com`, 'payment-password');
const orderIds = [];

after(() => {
  const db = getDb();
  for (const orderId of orderIds) {
    db.prepare('DELETE FROM payment_orders WHERE id = ?').run(orderId);
  }
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(user.id, otherUser.id);
});

describe('payment order foundation', () => {
  it('uses the server-side product price and rejects unsupported providers', () => {
    assert.throws(() => createPaymentOrder({
      userId: user.id,
      provider: 'card',
      amountFen: 1,
    }), /unsupported payment provider/);

    const order = createPaymentOrder({
      userId: user.id,
      provider: 'wechat',
      amountFen: 1,
    });
    orderIds.push(order.id);
    assert.equal(order.amountFen, PRODUCTS.pro_30d.amountFen);
    assert.equal(order.currency, 'CNY');
    assert.equal(order.status, 'pending');
  });

  it('prevents another user from reading an order', () => {
    const order = createPaymentOrder({ userId: user.id, provider: 'alipay' });
    orderIds.push(order.id);
    assert.equal(getPaymentOrder(order.id, otherUser.id), null);
  });

  it('marks payment once and grants 30 days of Pro', () => {
    setUserPlan(user.id, 'free');
    const order = createPaymentOrder({ userId: user.id, provider: 'wechat' });
    orderIds.push(order.id);
    const paidAt = new Date('2026-06-22T00:00:00.000Z');

    const first = markPaymentOrderPaid({
      outTradeNo: order.outTradeNo,
      provider: 'wechat',
      providerTransactionId: `wx-${randomUUID()}`,
      paidAt,
    });
    assert.equal(first.duplicate, false);
    assert.equal(first.order.status, 'paid');
    assert.equal(first.user.plan, 'pro');
    assert.equal(first.user.planExpiresAt, '2026-07-22T00:00:00.000Z');

    const duplicate = markPaymentOrderPaid({
      outTradeNo: order.outTradeNo,
      provider: 'wechat',
      providerTransactionId: `wx-${randomUUID()}`,
      paidAt,
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(getUserById(user.id).planExpiresAt, '2026-07-22T00:00:00.000Z');
  });

  it('extends an active paid period instead of replacing it', () => {
    setUserPlan(user.id, 'pro', '2026-08-01T00:00:00.000Z');
    const order = createPaymentOrder({ userId: user.id, provider: 'alipay' });
    orderIds.push(order.id);
    const result = markPaymentOrderPaid({
      outTradeNo: order.outTradeNo,
      provider: 'alipay',
      providerTransactionId: `ali-${randomUUID()}`,
      paidAt: '2026-06-22T00:00:00.000Z',
    });
    assert.equal(result.user.planExpiresAt, '2026-08-31T00:00:00.000Z');
  });
});
