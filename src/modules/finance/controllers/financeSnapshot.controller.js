const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/financeSnapshot.service');
const { listSnapshotsQuerySchema } = require('../validators/financeSnapshot.validator');
const { assertValid } = require('./requestValidation');

async function listSnapshots(req, res) {
  const query = assertValid(listSnapshotsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listSnapshots(query, req.auth),
  });
}

async function getSnapshotByOrderItem(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getSnapshotByOrderItem(req.params.orderItemId, req.auth),
  });
}

async function recalculateOrderItem(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recalculateOrderItem(req.params.orderItemId, req.auth),
  });
}

async function getOrderSummary(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getOrderSummary(req.params.orderId, req.auth),
  });
}

module.exports = {
  getOrderSummary,
  getSnapshotByOrderItem,
  listSnapshots,
  recalculateOrderItem,
};
