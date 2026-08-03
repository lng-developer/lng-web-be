const service = require('./services/financeSnapshot.service');

const publicPort = {
  getSnapshotByOrderItem: service.getSnapshotByOrderItem,
  listFilterOptions: service.listFilterOptionsByQuery,
  listSnapshotsByOrderItemIds: service.listSnapshotsByOrderItemIds,
  recalculateOrder: service.recalculateOrder,
  recalculateOrderItem: service.recalculateOrderItem,
  summarizeBySeller: service.summarizeBySeller,
  summarizeByTeam: service.summarizeByTeam,
  summarizeAdsByChannel: service.summarizeAdsByChannel,
  summarizeAdsDaily: service.summarizeAdsDaily,
  summarizeAdsBySeller: service.summarizeAdsBySeller,
  summarizeDaily: service.summarizeDaily,
  summarizeDailyProfit: service.summarizeDailyProfit,
};

module.exports = publicPort;
