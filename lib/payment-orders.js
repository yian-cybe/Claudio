import { randomBytes, randomUUID } from 'node:crypto';
import { getUserById } from './accounts.js';
import { getDb } from './db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDERS = new Set(['wechat', 'alipay']);

export const PRODUCTS = Object.freeze({
  pro_30d: Object.freeze({
    id: 'pro_30d',
    name: 'Claudio Pro 30 天',
    amountFen: 2900,
    currency: 'CNY',
    durationDays: 30,
  }),
});

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      out_trade_no TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      product_id TEXT NOT NULL,
      amount_fen INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_transaction_id TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created
      ON payment_orders(user_id, created_at DESC);
  `);
  return db;
}

function publicOrder(row) {
  return row ? {
    id: row.id,
    outTradeNo: row.out_trade_no,
    userId: row.user_id,
    provider: row.provider,
    productId: row.product_id,
    amountFen: Number(row.amount_fen),
    currency: row.currency,
    status: row.status,
    providerTransactionId: row.provider_transaction_id || null,
    paidAt: row.paid_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

function createOutTradeNo() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `CL${stamp}${randomBytes(6).toString('hex')}`;
}

export function createPaymentOrder({ userId, provider, productId = 'pro_30d' }) {
  if (!PROVIDERS.has(provider)) throw new Error('unsupported payment provider');
  const product = PRODUCTS[productId];
  if (!product) throw new Error('unsupported payment product');
  if (!getUserById(userId)) throw new Error('user not found');

  const order = {
    id: randomUUID(),
    outTradeNo: createOutTradeNo(),
    userId: String(userId),
    provider,
    productId: product.id,
    amountFen: product.amountFen,
    currency: product.currency,
  };
  const db = ensureTable();
  db.prepare(`
    INSERT INTO payment_orders (
      id, out_trade_no, user_id, provider, product_id, amount_fen, currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id,
    order.outTradeNo,
    order.userId,
    order.provider,
    order.productId,
    order.amountFen,
    order.currency
  );
  return getPaymentOrder(order.id, order.userId);
}

export function getPaymentOrder(orderId, userId) {
  const row = ensureTable().prepare(`
    SELECT * FROM payment_orders WHERE id = ? AND user_id = ?
  `).get(String(orderId), String(userId));
  return publicOrder(row);
}

export function getPaymentOrderByTradeNo(outTradeNo) {
  return publicOrder(ensureTable().prepare(
    'SELECT * FROM payment_orders WHERE out_trade_no = ?'
  ).get(String(outTradeNo)));
}

export function markPaymentOrderPaid({
  outTradeNo,
  provider,
  providerTransactionId,
  paidAt = new Date(),
}) {
  if (!PROVIDERS.has(provider)) throw new Error('unsupported payment provider');
  if (!providerTransactionId) throw new Error('provider transaction id required');
  const paidDate = new Date(paidAt);
  if (Number.isNaN(paidDate.getTime())) throw new Error('invalid paid at');

  const db = ensureTable();
  const row = db.prepare(
    'SELECT * FROM payment_orders WHERE out_trade_no = ?'
  ).get(String(outTradeNo));
  if (!row) throw new Error('payment order not found');
  if (row.provider !== provider) throw new Error('payment provider mismatch');
  if (row.status === 'paid') {
    return { duplicate: true, order: publicOrder(row), user: getUserById(row.user_id) };
  }
  if (row.status !== 'pending') throw new Error('payment order is not pending');

  const product = PRODUCTS[row.product_id];
  if (!product || row.amount_fen !== product.amountFen || row.currency !== product.currency) {
    throw new Error('payment order amount mismatch');
  }

  db.exec('BEGIN');
  try {
    const account = db.prepare(
      'SELECT plan_expires_at FROM users WHERE id = ?'
    ).get(row.user_id);
    if (!account) throw new Error('user not found');
    const existingExpiry = account.plan_expires_at ? new Date(account.plan_expires_at) : null;
    const baseDate = existingExpiry && existingExpiry > paidDate ? existingExpiry : paidDate;
    const expiresAt = new Date(baseDate.getTime() + product.durationDays * DAY_MS).toISOString();

    db.prepare(`
      UPDATE payment_orders
      SET status = 'paid',
          provider_transaction_id = ?,
          paid_at = ?,
          updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(String(providerTransactionId), paidDate.toISOString(), row.id);
    db.prepare(`
      UPDATE users SET plan = 'pro', plan_expires_at = ? WHERE id = ?
    `).run(expiresAt, row.user_id);
    db.exec('COMMIT');

    return {
      duplicate: false,
      order: getPaymentOrderByTradeNo(row.out_trade_no),
      user: getUserById(row.user_id),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
