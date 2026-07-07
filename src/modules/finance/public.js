const service = require('./services/financeSnapshot.service');

const publicPort = {
  getSnapshotByOrderItem: service.getSnapshotByOrderItem,
  listSnapshotsByOrderItemIds: service.listSnapshotsByOrderItemIds,
  recalculateOrderItem: service.recalculateOrderItem,
};

module.exports = publicPort;
