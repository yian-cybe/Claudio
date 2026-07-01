const buckets = new Map();
let operations = 0;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanExpired(now) {
  operations++;
  if (operations % 100 !== 0) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function clientIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

export function consume({ namespace, key, limit, windowMs, now = Date.now() }) {
  const max = positiveInteger(limit, 1);
  const duration = positiveInteger(windowMs, 60_000);
  const bucketKey = `${namespace}:${String(key || 'unknown')}`;
  cleanExpired(now);

  let bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + duration };
    buckets.set(bucketKey, bucket);
  }

  bucket.count++;
  const remaining = Math.max(0, max - bucket.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    allowed: bucket.count <= max,
    limit: max,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds,
  };
}

export function applyRateHeaders(res, result) {
  res.setHeader('RateLimit-Limit', String(result.limit));
  res.setHeader('RateLimit-Remaining', String(result.remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) res.setHeader('Retry-After', String(result.retryAfterSeconds));
}

export function rateLimit({ namespace, limit, windowMs, key }) {
  return (req, res, next) => {
    const result = consume({
      namespace,
      key: key ? key(req) : clientIp(req),
      limit,
      windowMs,
    });
    applyRateHeaders(res, result);
    if (!result.allowed) {
      return res.status(429).json({
        error: 'too many requests',
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    return next();
  };
}

export function resetRateLimits() {
  buckets.clear();
  operations = 0;
}

