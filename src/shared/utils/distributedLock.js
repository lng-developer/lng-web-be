const crypto = require('crypto');
const config = require('../../config');
const { getRedisClient } = require('../../config/redis');
const logger = require('./logger');

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Attempts to acquire a distributed lock in Redis.
 * @param {string} key Lock key
 * @param {number} ttlMs Time to live in milliseconds (default: 60,000ms)
 * @returns {Promise<string|null>} Unique token if acquired, null otherwise
 */
async function acquireLock(key, ttlMs = 60000) {
  if (!config.redis?.enabled) {
    return 'fallback-local-lock';
  }

  try {
    const redis = getRedisClient();
    if (!redis || redis.status !== 'ready') {
      return null;
    }
    const token = crypto.randomUUID();
    const result = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  } catch (error) {
    logger.warn('distributed_lock_acquire_failed', { key, error: error.message });
    return null;
  }
}

/**
 * Releases a distributed lock using Lua script to guarantee atomic ownership check.
 * @param {string} key Lock key
 * @param {string} token Lock token from acquireLock
 * @returns {Promise<boolean>}
 */
async function releaseLock(key, token) {
  if (!config.redis?.enabled || token === 'fallback-local-lock' || !token) {
    return true;
  }

  try {
    const redis = getRedisClient();
    if (!redis || redis.status !== 'ready') {
      return false;
    }
    const result = await redis.eval(RELEASE_LOCK_LUA, 1, `lock:${key}`, token);
    return result === 1;
  } catch (error) {
    logger.warn('distributed_lock_release_failed', { key, error: error.message });
    return false;
  }
}

/**
 * Helper to wrap an async task inside a distributed lock.
 * If the lock cannot be acquired (held by another node), fn is skipped and returns null.
 * When Redis is disabled, fn is called directly without microtask delay.
 * @param {string} key
 * @param {number|{ttlMs?: number}|Function} optionsOrFn
 * @param {Function} [maybeFn]
 */
function withDistributedLock(key, optionsOrFn, maybeFn) {
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  const ttlMs = typeof optionsOrFn === 'number'
    ? optionsOrFn
    : (typeof optionsOrFn === 'object' && optionsOrFn?.ttlMs ? optionsOrFn.ttlMs : 60000);

  if (typeof fn !== 'function') {
    throw new Error('withDistributedLock requires a function callback');
  }

  if (!config.redis?.enabled) {
    return fn();
  }

  return (async () => {
    const token = await acquireLock(key, ttlMs);
    if (!token) {
      logger.debug('distributed_lock_skipped', { key });
      return null;
    }

    try {
      return await fn();
    } finally {
      await releaseLock(key, token);
    }
  })();
}

module.exports = {
  acquireLock,
  releaseLock,
  withDistributedLock,
};
