const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/financeSnapshot.service');
const {
  listSnapshotsQuerySchema,
  orderIdParamsSchema,
} = require('../validators/financeSnapshot.validator');
const { assertValid } = require('./requestValidation');

function boundedAuditText(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function getHttpContext(req) {
  return {
    requestId: boundedAuditText(req.id, 200),
    ipAddress: boundedAuditText(req.ip, 100),
    userAgent: boundedAuditText(req.get('user-agent'), 500),
  };
}

function auditAuth(req) {
  return { ...req.auth, source: 'HTTP', auditContext: getHttpContext(req) };
}

async function listSnapshots(req, res) {
  const query = assertValid(listSnapshotsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listSnapshots(query, auditAuth(req)),
  });
}

async function listFilterOptions(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listFilterOptions(auditAuth(req)),
  });
}

async function getSnapshotByOrderItem(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getSnapshotByOrderItem(req.params.orderItemId, auditAuth(req)),
  });
}

async function recalculateOrderItem(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recalculateOrderItem(req.params.orderItemId, req.auth, getHttpContext(req)),
  });
}

async function recalculateOrder(req, res) {
  const params = assertValid(orderIdParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recalculateOrder(params.orderId, req.auth, getHttpContext(req)),
  });
}

async function getOrderSummary(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getOrderSummary(req.params.orderId, auditAuth(req)),
  });
}

module.exports = {
  getOrderSummary,
  getSnapshotByOrderItem,
  listSnapshots,
  listFilterOptions,
  recalculateOrder,
  recalculateOrderItem,
};
