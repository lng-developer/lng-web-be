const { createWorker } = require('../../../config/queue');
const { queueName, closeQueue } = require('../queues/listingContent.queue');
const { processGeneration, recoverGenerationRuns } = require('../services/listingContentGeneration.service');
const logger = require('../../../shared/utils/logger');

let worker;
let timer;
let recovery;

function recover() {
  if (recovery) return;
  recovery = (async () => {
    try { await recoverGenerationRuns(); }
    catch { logger.error('listing_content_recovery_failed'); }
  })().finally(() => { recovery = undefined; });
}

function startListingContentWorker() {
  if (worker) return worker;
  worker = createWorker(queueName, (job) => processGeneration(job.data.runId), {
    concurrency: 2, lockDuration: 120000, stalledInterval: 60000,
  });
  worker.on('error', () => logger.error('listing_content_worker_error'));
  recover();
  timer = setInterval(recover, 30000);
  timer.unref();
  return worker;
}

async function stopListingContentWorker() {
  clearInterval(timer);
  timer = undefined;
  const target = worker;
  worker = undefined;
  try { await Promise.all([target?.close(), recovery]); }
  finally { await closeQueue(); }
}

module.exports = { startListingContentWorker, stopListingContentWorker };
