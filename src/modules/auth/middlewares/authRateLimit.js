const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');

function createAuthRateLimit({ windowMs, max }) {
  const attempts = new Map();

  return function authRateLimit(req, res, next) {
    const now = Date.now();
    const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
    const key = `${req.ip || 'unknown'}:${identifier || 'anonymous'}`;
    const entry = attempts.get(key);
    const active = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + windowMs };
    active.count += 1;
    attempts.set(key, active);

    if (active.count <= max) return next();

    res.set('Retry-After', String(Math.ceil((active.resetAt - now) / 1000)));
    return res.status(httpStatus.TOO_MANY_REQUESTS).json({
      success: false,
      error: {
        code: errorCodes.RATE_LIMIT_ERROR,
        message: 'Too many authentication attempts',
        requestId: req.id,
      },
    });
  };
}

module.exports = { createAuthRateLimit };
