const { randomUUID } = require('crypto');
const repository = require('../repositories/fulfillmentSideEffectRequest.repository');
const orderPublic = require('../../order/public');
const logger = require('../../../shared/utils/logger');
const LEASE_MS = 120000;
let timer;
let recovering;

async function processOrder(orderId) {
  const token = randomUUID();
  const request = await repository.claim(orderId, token, LEASE_MS);
  if (!request) return { skipped: true };
  let lost = false;
  const renew = async () => {
    if (!await repository.renew(orderId, token, LEASE_MS)) lost = true;
    if (lost) throw Object.assign(new Error('Mapping execution lease lost'), { code: 'LEASE_LOST' });
  };
  let heartbeatRun;
  const heartbeat = setInterval(() => {
    if (!heartbeatRun) heartbeatRun = renew().catch(() => { lost = true; })
      .finally(() => { heartbeatRun = null; });
  }, LEASE_MS / 3);
  heartbeat.unref?.();
  try {
    const { applyFulfillmentSideEffects } = require('./fulfillmentPlan.service');
    for (const payload of Object.values(request.items || {})) {
      await renew();
      await applyFulfillmentSideEffects({ ...payload, orderId, deferOrderRefresh: true, strict: true });
    }
    await renew();
    await orderPublic.refreshFulfillmentStatusesForOrder(orderId);
    await renew();
    await repository.complete(orderId, token, request.requestedVersion);
    return { processed: Object.keys(request.items || {}).length };
  } catch (error) {
    await repository.fail(orderId, token, request.requestedVersion, error.code || 'SIDE_EFFECT_FAILED', new Date(Date.now() + 30000));
    logger.warn('mapping_side_effect_request_failed', { orderId, code: error.code || 'SIDE_EFFECT_FAILED' });
    return { deferred: true };
  } finally {
    clearInterval(heartbeat);
    await heartbeatRun;
  }
}

async function recover() {
  if (recovering) return recovering;
  recovering = (async () => {
    const rows = await repository.listDue(100);
    const { signalOrders } = require('./fulfillmentSideEffectQueue.service');
    for (let offset = 0; offset < rows.length; offset += 10) {
      await signalOrders(rows.slice(offset, offset + 10));
    }
  })();
  try { await recovering; } finally { recovering = null; }
}

function startFulfillmentSideEffectRecoveryScheduler() {
  if (timer) return timer;
  const tick = () => recover().catch((error) => logger.warn('mapping_side_effect_recovery_failed', { error }));
  timer = setInterval(tick, 30000);
  timer.unref?.();
  tick();
  return timer;
}

async function stopFulfillmentSideEffectRecoveryScheduler() {
  clearInterval(timer);
  timer = null;
  await recovering;
}

module.exports = { processOrder, recover, startFulfillmentSideEffectRecoveryScheduler, stopFulfillmentSideEffectRecoveryScheduler };
