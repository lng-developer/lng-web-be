const service = require('./services/financeSnapshot.service');

const publicPort = {
  getSnapshotByOrderItem: service.getSnapshotByOrderItem,
  listSnapshotsByOrderItemIds: service.listSnapshotsByOrderItemIds,
  recalculateOrder: service.recalculateOrder,
  recalculateOrderItem: service.recalculateOrderItem,
  summarizeBySeller: service.summarizeBySeller,
  summarizeByTeam: service.summarizeByTeam,
  summarizeAdsByChannel: service.summarizeAdsByChannel,
  summarizeDaily: service.summarizeDaily,
  summarizeDailyProfit: service.summarizeDailyProfit,
};

module.exports = publicPort;
