const { randomUUID } = require('crypto');
const { DelayedError } = require('bullmq');
const logger = require('../../../shared/utils/logger');
const config = require('../../../config');
const { createWorker } = require('../../../config/queue');
const { QUEUE_NAME, providerQueueName } = require('../services/vendorTrackingQueue.service');
const polls = require('../repositories/vendorTrackingPoll.repository');
const shipment = require('../services/shipment.service');

const settingsService = require('../services/trackingSyncConfig.service');
const { SUPPORTED_TRACKING_PROVIDERS } = require('../constants/shipment.constants');
let workers = [];

function classifyError(err, attempt) {
  if (err.trackingBusy) return { outcome: 'CLIENT_BUSY', delay: err.retryMs || 1000, attempt };
  const status = err.details?.statusCode;
  if (err.invalidTrackingReference || [400,404].includes(err.statusCode) || [400,401,403,404,422].includes(status)) {
    return { outcome: 'INVALID_REFERENCE', delay: 24 * 3600000, attempt: attempt + 1 };
  }
  const backoff = Math.min(3600000, 30000 * 2 ** Math.min(attempt, 8));
  return { outcome: status === 429 ? 'RATE_LIMITED' : 'TRANSIENT_FAILURE',
    delay: err.retryMs || backoff + Math.floor(Math.random() * backoff / 4), attempt: attempt + 1 };
}

async function processTrackingCheck(job, jobToken) {
  const settings = await settingsService.get();
  if (!settings.enabled) return { outcome: 'PAUSED' };
  const id = job.data.vendorSubmissionId;
  const token = randomUUID();
  const state = await polls.claim(id, token);
  if (!state) return { outcome: 'NOT_DUE' };
  let outcome;
  let delay;
  let attempt = 0;
  let clearPending = false;
  let admissionBusy = false;
  try {
    const result = await shipment.recheckVendorTracking({ vendorSubmissionId: id }, {
      system: true, source: 'VENDOR_TRACKING_WORKER',
    }, {
      pending: state.pendingUpdate,
      renew: () => polls.renew(id, token),
      remember: update => polls.remember(id, token, update),
      write: mutate => polls.withOwnedWrite(id, token, mutate),
    });
    if (result.reason === 'LEASE_LOST') return { outcome: 'LEASE_LOST' };
    clearPending = true;
    if (result.reason === 'NO_LONGER_ELIGIBLE' || shipment.shouldSkipShipment(result.shipment)) {
      outcome = 'COMPLETE';
      delay = null;
    } else {
      outcome = result.reason || 'CHECKED';
      delay = ['IDENTITY_CHANGED', 'SHIPMENT_CHANGED'].includes(outcome) ? 1000 : settings.intervalMinutes * 60000;
    }
  } catch (err) {
    if (err.code === 'TRACKING_LEASE_LOST') return { outcome: 'LEASE_LOST' };
    admissionBusy = Boolean(err.trackingBusy);
    ({ outcome, delay, attempt } = classifyError(err, state.attempt));
  }
  const now = new Date();
  const next = delay === null ? null : new Date(now.getTime() + delay);
  const saved = await polls.finish(id, token, outcome, next, now, attempt, clearPending);
  // Admission cooldown is short; keep the job delayed instead of waiting for the next discovery tick.
  if (saved && admissionBusy) {
    await job.moveToDelayed(next.getTime(), jobToken);
    throw new DelayedError();
  }
  const finalOutcome = saved ? outcome : 'LEASE_LOST';
  const log = ['INVALID_REFERENCE', 'RATE_LIMITED', 'TRANSIENT_FAILURE'].includes(finalOutcome) ? 'warn' : 'info';
  logger[log]('vendor_tracking_poll_finished', { vendorSubmissionId: id, outcome: finalOutcome, attempt, nextCheckAt: next });
  return { outcome: finalOutcome };
}

function startVendorTrackingWorker() {
  if (!config.shipment?.trackingQueueEnabled) return null;
  if (!workers.length) workers = [QUEUE_NAME, ...SUPPORTED_TRACKING_PROVIDERS.map(providerQueueName)]
    .map(name => createWorker(name, processTrackingCheck, { concurrency: 1 }));
  return workers;
}
async function stopVendorTrackingWorker() {
  await Promise.all(workers.map(worker => worker.close()));
  workers = [];
}
module.exports = { processTrackingCheck, classifyError, startVendorTrackingWorker, stopVendorTrackingWorker };
