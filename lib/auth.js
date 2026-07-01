import { getUserBySession } from './accounts.js';
import { verificationRequired } from './email-verification.js';

const TOKEN = process.env.API_TOKEN;
export const SESSION_COOKIE = 'claudio_session';

export function enabled() {
  return process.env.NODE_ENV === 'production' || !!TOKEN;
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

export function sessionCookie(token, expiresAt) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function requestIdentity(req, queryToken) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (TOKEN && (bearer === TOKEN || queryToken === TOKEN)) return { type: 'admin', id: 'admin' };
  const sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const user = getUserBySession(sessionToken);
  if (user) return { type: 'user', id: user.id, user, sessionToken };
  if (process.env.NODE_ENV !== 'production') return { type: 'guest', id: 'guest' };
  return null;
}

export function requireAuth(req, res, next) {
  const identity = requestIdentity(req, req.query?.token);
  if (!identity) return res.status(401).json({ error: 'authentication required' });
  req.identity = identity;
  req.user = identity.user || null;
  return next();
}

export function requireVerified(req, res, next) {
  if (
    verificationRequired()
    && req.identity?.type === 'user'
    && !req.identity.user?.emailVerified
  ) {
    return res.status(403).json({ error: 'email verification required' });
  }
  return next();
}

export function verifyToken(value) {
  return !!TOKEN && value === TOKEN;
}
