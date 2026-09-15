const { createWorker } = require('../../../config/queue');
const { queueName, closeQueue } = require('../queues/listingContent.queue');
const { processGeneration, recoverGenerationRuns } = require('../services/listingContentGeneration.service');
const logger = require('../../../shared/utils/logger');

let worker;
let timer;
let recovery;
let recoveryController;
let stopping;
const active = new Set();

async function waitWithin(promise, timeoutMs) {
  let deadline;
  try {
    return await Promise.race([Promise.resolve(promise).then(() => true), new Promise((resolve) => {
      deadline = setTimeout(() => resolve(false), timeoutMs);
    })]);
  } finally { clearTimeout(deadline); }
}

function recover() {
  if (recovery) return;
  const controller = recoveryController;
  recovery = (async () => {
    try { await recoverGenerationRuns({ signal: controller.signal }); }
    catch { logger.error('listing_content_recovery_failed'); }
  })().finally(() => { if (recoveryController === controller) recovery = undefined; });
}

function startListingContentWorker() {
  if (worker) return worker;
  recoveryController = new AbortController();
  worker = createWorker(queueName, async (job) => {
    const processing = processGeneration(job.data.runId);
    active.add(processing);
    try { return await processing; }
    finally { active.delete(processing); }
  }, {
    concurrency: 2, lockDuration: 120000, stalledInterval: 60000,
  });
  worker.on('error', () => logger.error('listing_content_worker_error'));
  recover();
  timer = setInterval(recover, 30000);
  timer.unref();
  return worker;
}

function stopListingContentWorker() {
  if (stopping) return stopping;
  clearInterval(timer);
  timer = undefined;
  recoveryController?.abort();
  const target = worker;
  stopping = (async () => {
    try {
      if (target) {
        try {
          await waitWithin(target.pause(true), 3000);
          await waitWithin(Promise.allSettled([...active, recovery]), 120000);
        } finally {
          // First close must be forced: BullMQ caches close(false) while waiting on Redis writes.
          const closed = await waitWithin(target.close(true), 3000).catch(() => false);
          if (!closed) await waitWithin(target.disconnect(), 3000);
        }
      }
    } finally {
      worker = undefined;
      recovery = undefined;
      active.clear();
      await closeQueue();
    }
  })().finally(() => { stopping = undefined; });
  return stopping;
}

module.exports = { startListingContentWorker, stopListingContentWorker };
