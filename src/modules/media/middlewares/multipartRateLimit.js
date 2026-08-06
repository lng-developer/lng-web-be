function createMultipartRateLimit({ windowMs, max }) {
  const buckets = new Map();
  return function multipartRateLimit(req, res, next) {
    const now = Date.now();
    const key = String(req.auth?.accountId || req.ip || 'anonymous');
    const current = buckets.get(key);
    const bucket = !current || current.expiresAt <= now
      ? { count: 0, expiresAt: now + windowMs }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    // ponytail: per-process limit; move to Redis when multiple web replicas make this ceiling ineffective.
    if (bucket.count > max) {
      res.status(429).json({ success: false, code: 'RATE_LIMIT_ERROR', message: 'Too many upload requests' });
      return;
    }
    next();
  };
}

module.exports = { createMultipartRateLimit };
