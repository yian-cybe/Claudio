const TOKEN = process.env.API_TOKEN;

export function enabled() {
  return !!TOKEN;
}

export function requireAuth(req, res, next) {
  if (!TOKEN) return next();
  const hdr = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  const q = req.query?.token;
  if (verifyToken(hdr) || verifyToken(q)) return next();
  return res.status(401).json({ error: 'unauthorized — set Authorization: Bearer <API_TOKEN>' });
}

export function verifyToken(t) {
  if (!TOKEN) return true;
  return t === TOKEN;
}
