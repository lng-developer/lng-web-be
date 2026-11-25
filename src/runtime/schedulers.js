const config = require('../config');
const {
  startPostImportMappingRecoveryScheduler,
  stopPostImportMappingRecoveryScheduler,
} = require('../modules/integration/externalOrderImport/services/postImportMappingRecoveryScheduler.service');
const {
  startVendorTrackingRecheckScheduler,
  stopVendorTrackingRecheckScheduler,
} = require('../modules/shipment/services/vendorTrackingRecheckScheduler.service');
const {
  startVendorSubmissionRecoveryScheduler,
  stopVendorSubmissionRecoveryScheduler,
} = require('../modules/vendorSubmission/services/vendorSubmissionRecoveryScheduler.service');
const {
  startExtensionOrderScheduleScheduler,
  stopExtensionOrderScheduleScheduler,
} = require('../modules/integration/extensionCommand/services/extensionOrderScheduleScheduler.service');
const {
  startMongoIndexUsageSnapshotScheduler,
  stopMongoIndexUsageSnapshotScheduler,
} = require('../modules/audit/services/mongoIndexUsageSnapshotScheduler.service');
const {
  startAmazonAdsEmailImportScheduler,
  stopAmazonAdsEmailImportScheduler,
} = require('../modules/integration/amazonAdsEmail/services/amazonAdsEmailImportScheduler.service');

async function startSchedulers(registerStop) {
  if (!config.backgroundJobsEnabled) return;
  const orderPublic = require('../modules/order/public');
  const hrPublic = require('../modules/hr/public');
  const { teamsChat, sqlAttendance } = require('../modules/integration/public');
  const schedulers = [
    [startMongoIndexUsageSnapshotScheduler, stopMongoIndexUsageSnapshotScheduler],
    [orderPublic.startOrderTrackingDeadlineScheduler, orderPublic.stopOrderTrackingDeadlineScheduler],
    [hrPublic.startMonthlyLeaveAccrualScheduler, hrPublic.stopMonthlyLeaveAccrualScheduler],
  ];
  if (config.outboundEnabled) {
    schedulers.push(
      [startVendorTrackingRecheckScheduler, stopVendorTrackingRecheckScheduler],
      [startVendorSubmissionRecoveryScheduler, stopVendorSubmissionRecoveryScheduler],
      [startExtensionOrderScheduleScheduler, stopExtensionOrderScheduleScheduler],
      [startAmazonAdsEmailImportScheduler, stopAmazonAdsEmailImportScheduler],
      [teamsChat.startTeamsSubscriptionScheduler, teamsChat.stopTeamsSubscriptionScheduler],
      [teamsChat.startTeamsOutboundOutboxScheduler, teamsChat.stopTeamsOutboundOutboxScheduler],
      [sqlAttendance.startSqlAttendanceScheduler, sqlAttendance.stopSqlAttendanceScheduler],
    );
  }
  if (config.redis.enabled) {
    schedulers.push([startPostImportMappingRecoveryScheduler, stopPostImportMappingRecoveryScheduler]);
  }
  for (const [start, stop] of schedulers) {
    registerStop(stop);
    await start();
  }
  if (config.mapping.durableSideEffectsEnabled) {
    const {
      startFulfillmentSideEffectRecoveryScheduler,
      stopFulfillmentSideEffectRecoveryScheduler,
    } = require('../modules/mapping/services/fulfillmentSideEffectRequest.service');
    registerStop(stopFulfillmentSideEffectRecoveryScheduler);
    await startFulfillmentSideEffectRecoveryScheduler();
  }
  if (config.finance.durableRecalculationEnabled) {
    const { startFinanceRecalculationRecovery } = require('../modules/finance/services/financeSnapshotQueue.service');
    const recovery = startFinanceRecalculationRecovery();
    registerStop(() => recovery.close());
  }
}

module.exports = { startSchedulers };
