const service = require('./services/financeSnapshot.service');

const publicPort = {
  getSnapshotByOrderItem: service.getSnapshotByOrderItem,
  listSnapshotsByOrderItemIds: service.listSnapshotsByOrderItemIds,
  recalculateOrder: service.recalculateOrder,
  recalculateOrderItem: service.recalculateOrderItem,
  summarizeBySeller: service.summarizeBySeller,
  summarizeByTeam: service.summarizeByTeam,
  summarizeDaily: service.summarizeDaily,
};

module.exports = publicPort;
