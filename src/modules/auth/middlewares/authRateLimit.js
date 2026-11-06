const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const config = require('../../../config');
const { getRedisClient } = require('../../../config/redis');
const logger = require('../../../shared/utils/logger');

const RATE_LIMIT_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {current, ttl}
`;

function createAuthRateLimit({ windowMs, max }) {
  const memoryAttempts = new Map();

  function memoryRateLimit(key, now, req, res, next) {
    // Memory leak protection: periodically prune expired keys
    if (memoryAttempts.size > 500) {
      for (const [k, v] of memoryAttempts.entries()) {
        if (v.resetAt <= now) memoryAttempts.delete(k);
      }
    }

    const entry = memoryAttempts.get(key);
    const active = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + windowMs };
    active.count += 1;
    memoryAttempts.set(key, active);

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
  }

  return function authRateLimit(req, res, next) {
    if (!config.auth.loginRateLimitEnabled) return next();

    const now = Date.now();
    const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
    const key = `${req.ip || 'unknown'}:${identifier || 'anonymous'}`;

    if (!config.redis?.enabled) {
      return memoryRateLimit(key, now, req, res, next);
    }

    let redis;
    try {
      redis = getRedisClient();
    } catch {
      // Redis client instantiation failure fallback
      return memoryRateLimit(key, now, req, res, next);
    }

    if (!redis || redis.status !== 'ready') {
      return memoryRateLimit(key, now, req, res, next);
    }

    const redisKey = `ratelimit:auth:${key}`;
    return redis.eval(RATE_LIMIT_LUA, 1, redisKey, windowMs)
      .then(([current, ttl]) => {
        if (current <= max) {
          return next();
        }

        const retryAfter = Math.max(1, Math.ceil(Number(ttl) / 1000));
        res.set('Retry-After', String(retryAfter));
        return res.status(httpStatus.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: errorCodes.RATE_LIMIT_ERROR,
            message: 'Too many authentication attempts',
            requestId: req.id,
          },
        });
      })
      .catch((error) => {
        logger.warn('auth_rate_limit_redis_failed', { key, error: error.message });
        return memoryRateLimit(key, now, req, res, next);
      });
  };
}

module.exports = { createAuthRateLimit };
