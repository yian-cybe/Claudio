import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.js';

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;

function ensureTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      plan_expires_at TEXT,
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'email_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
    db.exec("UPDATE users SET email_verified_at = datetime('now') WHERE email_verified_at IS NULL");
  }
  if (!userColumns.some((column) => column.name === 'plan_expires_at')) {
    db.exec('ALTER TABLE users ADD COLUMN plan_expires_at TEXT');
  }
  return db;
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('请输入有效邮箱');
  if (String(password || '').length < 8) throw new Error('密码至少需要 8 个字符');
  return { email: normalizedEmail, password: String(password) };
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored || '').split(':');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

function publicUser(row) {
  return row ? {
    id: row.id,
    email: row.email,
    plan: row.plan,
    planExpiresAt: row.plan_expires_at || null,
    emailVerified: !!row.email_verified_at,
  } : null;
}

function expireElapsedPlans(db) {
  db.prepare(`
    UPDATE users
    SET plan = 'free', plan_expires_at = NULL
    WHERE plan = 'pro'
      AND plan_expires_at IS NOT NULL
      AND datetime(plan_expires_at) <= datetime('now')
  `).run();
}

export function createUser(email, password) {
  const valid = validateCredentials(email, password);
  const db = ensureTables();
  const user = { id: randomUUID(), email: valid.email, plan: 'free', emailVerified: false };
  try {
    db.prepare('INSERT INTO users (id, email, password_hash, plan) VALUES (?, ?, ?, ?)')
      .run(user.id, user.email, hashPassword(valid.password), user.plan);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('该邮箱已注册');
    throw error;
  }
  return user;
}

export function authenticateUser(email, password) {
  const db = ensureTables();
  expireElapsedPlans(db);
  const row = db.prepare(
    'SELECT id, email, password_hash, plan, plan_expires_at, email_verified_at FROM users WHERE email = ?'
  ).get(normalizeEmail(email));
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return publicUser(row);
}

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  ensureTables().prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), userId, expiresAt.toISOString());
  return { token, expiresAt };
}

export function getUserBySession(token) {
  if (!token) return null;
  const db = ensureTables();
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  expireElapsedPlans(db);
  return publicUser(db.prepare(`
    SELECT users.id, users.email, users.plan, users.plan_expires_at, users.email_verified_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')
  `).get(tokenHash(token)));
}

export function deleteSession(token) {
  if (token) ensureTables().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function setUserPlan(userId, plan, expiresAt = null) {
  if (!['free', 'pro'].includes(plan)) throw new Error('invalid plan');
  const normalizedExpiry = plan === 'pro' && expiresAt
    ? new Date(expiresAt).toISOString()
    : null;
  const db = ensureTables();
  const result = db.prepare('UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?')
    .run(plan, normalizedExpiry, String(userId));
  if (Number(result.changes) !== 1) throw new Error('user not found');
  return publicUser(db.prepare(
    'SELECT id, email, plan, plan_expires_at, email_verified_at FROM users WHERE id = ?'
  ).get(String(userId)));
}

export function getUserById(userId) {
  const db = ensureTables();
  expireElapsedPlans(db);
  return publicUser(db.prepare(
    'SELECT id, email, plan, plan_expires_at, email_verified_at FROM users WHERE id = ?'
  ).get(String(userId)));
}
