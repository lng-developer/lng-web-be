const crypto = require('crypto');
const redisConfig = require('../../../config/redis');

// One atomic admission across API and worker processes. Expiry recovers crashed owners.
const acquire = `
local owner = redis.call('get', KEYS[1])
if owner == 'cooldown' then return -redis.call('pttl', KEYS[1]) end
if owner then return 0 end
for i = 2, 3 do
  if redis.call('exists', KEYS[i]) == 0 then
    redis.call('psetex', KEYS[i], ARGV[2], ARGV[1])
    redis.call('psetex', KEYS[1], ARGV[2], ARGV[1])
    return i
  end
end
return 0`;
const renew = `
if redis.call('get',KEYS[1]) ~= ARGV[1] or redis.call('get',KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('pexpire',KEYS[1],ARGV[2])
redis.call('pexpire',KEYS[2],ARGV[2])
return 1`;
const release = `
if redis.call('get',KEYS[1]) == ARGV[1] then
  if tonumber(ARGV[2]) > 0 then redis.call('psetex',KEYS[1],ARGV[2],'cooldown')
  else redis.call('del',KEYS[1]) end
end
if redis.call('get',KEYS[2]) == ARGV[1] then redis.call('del',KEYS[2]) end
return 1`;

function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const ms = /^\d+(\.\d+)?$/.test(String(value)) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms)) : 0;
}

function clientGuardKey(credential) {
  const identity = credential.metadata?.clientId || credential.apiKey || credential.vendorId || credential.accessToken;
  return crypto.createHash('sha256').update(String(identity)).digest('hex');
}

async function withClientGuard(provider, digest, action) {
  const prefix = 'tracking:{vendor-poll}';
  const keys = [`${prefix}:${provider}:${digest}`, `${prefix}:slot:1`, `${prefix}:slot:2`];
  const token = crypto.randomUUID();
  const redis = redisConfig.getRedisClient();
  if (redis.status && redis.status !== 'ready') throw new Error('Vendor tracking guard unavailable');
  const slot = await redis.eval(acquire, 3, ...keys, token, 120000);
  if (slot <= 0) {
    const err = new Error('Vendor tracking client is busy');
    err.trackingBusy = true;
    err.retryMs = Math.max(1000, -slot);
    throw err;
  }
  const renewGuard = () => redis.eval(renew, 2, keys[0], keys[slot - 1], token, 120000);
  const timer = setInterval(() => { renewGuard().catch(() => {}); }, 30000);
  timer.unref?.();
  let cooldown = 0;
  try {
    return await action(renewGuard);
  } catch (err) {
    if (err.vendorHttpStatus === 429) {
      cooldown = retryAfterMs(err.retryAfter) || 60000;
      err.retryMs = cooldown;
    }
    throw err;
  } finally {
    clearInterval(timer);
    await redis.eval(release, 2, keys[0], keys[slot - 1], token, cooldown);
  }
}
module.exports = { clientGuardKey, withClientGuard, retryAfterMs };
