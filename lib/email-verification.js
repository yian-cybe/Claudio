import { createHash, randomBytes } from 'node:crypto';
import { getDb } from './db.js';
import { getUserById } from './accounts.js';

const TOKEN_HOURS = Number(process.env.EMAIL_VERIFICATION_HOURS) || 24;

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id, created_at)'
  );
  return db;
}

export function issueToken(userId, now = Date.now()) {
  const user = getUserById(userId);
  if (!user) throw new Error('user not found');
  if (user.emailVerified) return { alreadyVerified: true, user };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now + TOKEN_HOURS * 60 * 60 * 1000);
  const db = ensureTable();
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);
  db.prepare(`
    INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(tokenHash(token), user.id, expiresAt.toISOString());
  return { token, expiresAt, user };
}

export function verifyToken(token, now = Date.now()) {
  if (!token) throw new Error('verification token required');
  const db = ensureTable();
  const row = db.prepare(`
    SELECT token_hash, user_id, expires_at, used_at
    FROM email_verification_tokens
    WHERE token_hash = ?
  `).get(tokenHash(token));
  if (!row || row.used_at) throw new Error('verification token invalid');
  if (new Date(row.expires_at).getTime() <= now) throw new Error('verification token expired');

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?")
      .run(row.user_id);
    db.prepare("UPDATE email_verification_tokens SET used_at = datetime('now') WHERE token_hash = ?")
      .run(row.token_hash);
    db.exec('COMMIT');
    return getUserById(row.user_id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function verificationRequired() {
  return process.env.EMAIL_VERIFICATION_REQUIRED === 'true';
}

