const config = require('../../../config');
const { createQueue } = require('../../../config/queue');
const logger = require('../../../shared/utils/logger');

const requests = require('../repositories/financeRecalculationRequest.repository');

const QUEUE_NAME = 'finance-snapshot-recalculation';
let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

async function signalRequest(claim) {
  if (!config.redis.enabled) return { queued: false, persisted: true };
  try {
    const job = await getQueue().add('recalculate', {
      orderItemId: claim._id, requestedVersion: claim.requestedVersion,
    }, {
      jobId: `finance-version-${claim._id}-${claim.requestedVersion}`,
      attempts: 3, backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true, removeOnFail: true,
    });
    return { queued: true, persisted: true, jobId: String(job.id) };
  } catch (error) {
    logger.warn('finance_snapshot_queue_unavailable', { orderItemId: claim._id, error });
    return { queued: false, persisted: true };
  }
}

async function recoverPendingRequests() {
  for (const claim of await requests.due(100)) {
    await signalRequest(claim);
    await requests.postponeSignal(claim);
  }
}

function startFinanceRecalculationRecovery() {
  if (!config.finance?.durableRecalculationEnabled) return { close: async () => {} };
  const { refreshAgedSnapshots } = require('./financeSnapshotReconciliation.service');
  let active;
  let nextRefresh = 0;
  async function scan() {
    await recoverPendingRequests();
    if (Date.now() >= nextRefresh) {
      nextRefresh = Date.now() + 60000;
      await refreshAgedSnapshots();
    }
  }
  function tick() {
    if (!active) active = scan()
      .catch((error) => logger.error('finance_recalculation_recovery_failed', { error }))
      .finally(() => { active = null; });
  }
  const timer = setInterval(tick, 15000);
  timer.unref();
  tick();
  return { close: async () => { clearInterval(timer); await active; } };
}

async function enqueueSnapshotRecalculation({ orderItemId, reason, importBatchId = null }, options = {}) {
  if (config.finance?.durableRecalculationEnabled) {
    const claim = await requests.request({ orderItemId, importBatchId, reason }, options);
    if (options.session) return { persisted: true, queued: false };
    return signalRequest(claim);
  }
  if (!config.redis.enabled) return { queued: false };
  try {
    const job = await getQueue().add('recalculate', {
      orderItemId, reason, ...(importBatchId ? { importBatchId: String(importBatchId) } : {}),
    }, {
      jobId: importBatchId
        ? `finance-snapshot-${importBatchId}-${orderItemId}`
        : `finance-snapshot-${orderItemId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { queued: true, jobId: String(job.id) };
  } catch (error) {
    logger.warn('finance_snapshot_queue_unavailable', { orderItemId, reason, error });
    return { queued: false };
  }
}

module.exports = { QUEUE_NAME, enqueueSnapshotRecalculation, recoverPendingRequests, startFinanceRecalculationRecovery };
