const service = require('./services/financeSnapshot.service');
const financeImportService = require('./services/financeImport.service');
const { enqueueSnapshotRecalculation } = require('./services/financeSnapshotQueue.service');
const { reconcileSnapshots } = require('./services/financeSnapshotReconciliation.service');

const publicPort = {
  getSnapshotByOrderItem: service.getSnapshotByOrderItem,
  listFilterOptions: service.listFilterOptionsByQuery,
  listSnapshotsByOrderItemIds: service.listSnapshotsByOrderItemIds,
  recalculateOrder: service.recalculateOrder,
  recalculateOrderItem: service.recalculateOrderItem,
  requestSnapshotRecalculation: enqueueSnapshotRecalculation,
  reconcileSnapshots,
  summarizeBySeller: service.summarizeBySeller,
  summarizeSellerDaily: service.summarizeSellerDaily,
  summarizeByTeam: service.summarizeByTeam,
  summarizeAdsByChannel: service.summarizeAdsByChannel,
  summarizeAdsDaily: service.summarizeAdsDaily,
  summarizeAdsBySeller: service.summarizeAdsBySeller,
  summarizeAdsSellerDaily: service.summarizeAdsSellerDaily,
  summarizeDaily: service.summarizeDaily,
  summarizeDailyProfit: service.summarizeDailyProfit,
  importAdsFromFile: financeImportService.importAdsFromFile,
  importMappedAdsFromFile: financeImportService.importMappedAdsFromFile,
  hasCompletedAdsImportSource: financeImportService.hasCompletedAdsImportSource,
};

module.exports = publicPort;
