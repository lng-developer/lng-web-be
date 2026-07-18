const logger = require('../../../../shared/utils/logger');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const { processPostImportMapping } = require('./postImportMappingProcessor.service');

const RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;
const BATCH_LIMIT = 50;

let timer = null;
let running = false;

function toPayload(rawRecord) {
  return {
    importJobId: rawRecord.importJobId,
    rawRecordId: rawRecord._id,
    orderId: rawRecord.orderId,
    orderItemId: rawRecord.orderItemId,
    externalOrderId: rawRecord.externalOrderId,
    externalItemId: rawRecord.externalItemId,
    source: 'EXTERNAL_ORDER_IMPORT',
  };
}

async function runOnce({ staleAfterMs = STALE_AFTER_MS, limit = BATCH_LIMIT } = {}) {
  if (running) return null;
  running = true;
  const result = { checked: 0, processed: 0, skipped: 0, failed: 0 };
  try {
    const records = await rawRecordRepository.listStalePostImportRecords({
      cutoff: new Date(Date.now() - staleAfterMs),
      limit,
    });
    for (const record of records) {
      result.checked += 1;
      try {
        const processed = await processPostImportMapping(toPayload(record), { isFinalAttempt: true });
        if (processed.skipped) result.skipped += 1;
        else result.processed += 1;
      } catch (error) {
        result.failed += 1;
        logger.warn('external_order_post_import_recovery_failed', {
          rawRecordId: record._id,
          orderItemId: record.orderItemId,
          error,
        });
      }
    }
    return result;
  } finally {
    running = false;
  }
}

function startPostImportMappingRecoveryScheduler() {
  if (timer) return timer;
  runOnce({ staleAfterMs: 0 }).catch((error) => logger.warn('external_order_post_import_recovery_startup_failed', { error }));
  timer = setInterval(() => {
    runOnce().catch((error) => logger.warn('external_order_post_import_recovery_failed', { error }));
  }, RECOVERY_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function stopPostImportMappingRecoveryScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  runOnce,
  startPostImportMappingRecoveryScheduler,
  stopPostImportMappingRecoveryScheduler,
};
