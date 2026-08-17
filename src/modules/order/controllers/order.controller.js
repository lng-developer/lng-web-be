const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const orderQueryService = require('../services/orderQuery.service');
const orderExportService = require('../services/orderExport.service');
const orderAddressValidationService = require('../services/orderAddressValidation.service');
const orderReadinessService = require('../services/orderReadiness.service');
const orderAssignmentService = require('../services/orderAssignment.service');
const orderOperationsService = require('../services/orderOperations.service');
const orderCaseService = require('../services/orderCase.service');
const orderItemRecheckService = require('../services/orderItemRecheck.service');
const orderReplacementService = require('../services/orderReplacement.service');
const orderItemCancelService = require('../services/orderItemCancel.service');
const customerExceptionService = require('../services/customerException.service');
const orderDesignRequestService = require('../services/orderDesignRequest.service');
const {
  toOrderDto,
  toPaginatedOrderDto,
  toOrderSummaryDto,
  toOrderWorkbenchDto,
  toOrderExpandedDto,
} = require('../dtos/order.dto');
const {
  toOrderItemDto,
  toPaginatedOrderItemDto,
} = require('../dtos/orderItem.dto');
const {
  toPaginatedOrderTimelineDto,
} = require('../dtos/orderTimeline.dto');
const {
  toOrderCaseDto,
  toPaginatedOrderCaseDto,
} = require('../dtos/orderCase.dto');
const {
  listOrdersQuerySchema,
  exportOrdersQuerySchema,
  orderIdParamSchema,
  listOrderItemsQuerySchema,
  orderItemIdParamSchema,
  paginationQuerySchema,
  buyerSchema,
  csNoteSchema,
  overrideAddressSchema,
  shippingAddressSchema,
  shippingServiceSchema,
  assignStaffSchema,
  orderCaseIdParamSchema,
  listOrderCasesQuerySchema,
  createOrderCaseSchema,
  updateOrderCaseSchema,
  resolveOrderCaseSchema,
  cancelOrderCaseSchema,
  createReplacementSchema,
  createOrderReplacementSchema,
  cancelOrderItemSchema,
  requestDesignFileSchema,
  addOrderCaseCommentSchema,
  customerExceptionsQuerySchema,
  validate,
} = require('../validators/order.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

function auditAuth(req) {
  return {
    ...req.auth,
    actorType: req.auth?.accountId ? 'ACCOUNT' : 'SYSTEM',
    source: 'HTTP',
    auditContext: {
      requestId: req.id ? String(req.id).slice(0, 200) : null,
      ipAddress: req.ip ? String(req.ip).slice(0, 100) : null,
      userAgent: req.get?.('user-agent') ? String(req.get('user-agent')).slice(0, 500) : null,
    },
  };
}

async function listOrders(req, res) {
  const query = assertValid(listOrdersQuerySchema, req.query);
  const result = await orderQueryService.listOrders(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedOrderDto(result) });
}

async function listOrderWorkbench(req, res) {
  const query = assertValid(listOrdersQuerySchema, req.query);
  const result = await orderQueryService.listOrderWorkbench(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderWorkbenchDto(result) });
}

async function getOrderSummary(req, res) {
  const query = assertValid(listOrdersQuerySchema, req.query);
  const result = await orderQueryService.getOrderSummary(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderSummaryDto(result) });
}

async function getOrder(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const result = await orderQueryService.getOrder(orderId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function getExpandedOrder(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const result = await orderQueryService.getExpandedOrder(orderId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderExpandedDto(result) });
}

async function listOrderItems(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const query = assertValid(listOrderItemsQuerySchema, req.query);
  const result = await orderQueryService.listOrderItems(orderId, query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedOrderItemDto(result) });
}

async function getOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const result = await orderQueryService.getOrderItem(orderItemId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderItemDto(result) });
}

async function getOrderItemReadiness(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const result = await orderReadinessService.getOrderItemReadiness(orderItemId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function markFulfillmentReady(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const result = await orderReadinessService.markFulfillmentReady(orderItemId, auditAuth(req));

  res.status(httpStatus.OK).json({
    success: true,
    data: {
      item: toOrderItemDto(result.item),
      readiness: result.readiness,
    },
  });
}

async function listCustomerExceptions(req, res) {
  const query = assertValid(customerExceptionsQuerySchema, req.query);
  const result = await customerExceptionService.listCustomerExceptions(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function recheckOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const result = await orderItemRecheckService.recheckOrderItem(orderItemId, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createReplacementForItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const body = assertValid(createReplacementSchema, req.body || {});
  const result = await orderReplacementService.createReplacementForItem(orderItemId, body, auditAuth(req));

  res.status(httpStatus.CREATED).json({ success: true, data: toOrderItemDto(result) });
}

async function createReplacementForOrder(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const body = assertValid(createOrderReplacementSchema, req.body || {});
  const result = await orderReplacementService.createReplacementForOrder(orderId, body, auditAuth(req));

  res.status(httpStatus.CREATED).json({
    success: true,
    data: {
      order: toOrderDto(result.order),
      items: result.items.map(toOrderItemDto),
    },
  });
}

async function cancelOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const body = assertValid(cancelOrderItemSchema, req.body || {});
  const result = await orderItemCancelService.cancelOrderItem(orderItemId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderItemDto(result) });
}

async function listOrderTimeline(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const query = assertValid(paginationQuerySchema, req.query);
  const result = await orderQueryService.listOrderTimeline(orderId, query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedOrderTimelineDto(result) });
}

async function updateShippingAddress(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const body = assertValid(shippingAddressSchema, req.body);
  const result = await orderAddressValidationService.updateShippingAddress(orderId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function updateBuyer(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const body = assertValid(buyerSchema, req.body);
  const result = await orderOperationsService.updateBuyer(orderId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function updateShippingService(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const body = assertValid(shippingServiceSchema, req.body);
  const result = await orderOperationsService.updateShippingService(orderId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function updateOrderItemCsNote(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const { csNote } = assertValid(csNoteSchema, req.body);
  const result = await orderOperationsService.updateOrderItemCsNote(orderItemId, csNote, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderItemDto(result) });
}

async function listOrderCases(req, res) {
  const query = assertValid(listOrderCasesQuerySchema, req.query);
  const result = await orderCaseService.listOrderCases(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedOrderCaseDto(result) });
}

async function getOrderCase(req, res) {
  const { caseId } = assertValid(orderCaseIdParamSchema, req.params);
  const result = await orderCaseService.getOrderCase(caseId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderCaseDto(result) });
}

async function createOrderCase(req, res) {
  const body = assertValid(createOrderCaseSchema, req.body);
  const result = await orderCaseService.createOrderCase(body, auditAuth(req));

  res.status(httpStatus.CREATED).json({ success: true, data: toOrderCaseDto(result) });
}

async function updateOrderCase(req, res) {
  const { caseId } = assertValid(orderCaseIdParamSchema, req.params);
  const body = assertValid(updateOrderCaseSchema, req.body);
  const result = await orderCaseService.updateOrderCase(caseId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderCaseDto(result) });
}

async function resolveOrderCase(req, res) {
  const { caseId } = assertValid(orderCaseIdParamSchema, req.params);
  const body = assertValid(resolveOrderCaseSchema, req.body);
  const result = await orderCaseService.resolveOrderCase(caseId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderCaseDto(result) });
}

async function cancelOrderCase(req, res) {
  const { caseId } = assertValid(orderCaseIdParamSchema, req.params);
  const body = assertValid(cancelOrderCaseSchema, req.body);
  const result = await orderCaseService.cancelOrderCase(caseId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderCaseDto(result) });
}

async function addOrderCaseComment(req, res) {
  const { caseId } = assertValid(orderCaseIdParamSchema, req.params);
  const body = assertValid(addOrderCaseCommentSchema, req.body || {});
  const result = await orderCaseService.addOrderCaseComment(caseId, body, auditAuth(req));

  res.status(httpStatus.CREATED).json({ success: true, data: toOrderCaseDto(result) });
}

async function validateAddress(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const result = await orderAddressValidationService.validateAddressForOrder(orderId, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function exportOrdersCsv(req, res) {
  const query = assertValid(exportOrdersQuerySchema, req.query);
  const result = await orderExportService.exportOrdersCsv(query, req.auth);

  res
    .status(httpStatus.OK)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${result.filename}"`)
    .send(result.csv);
}

async function overrideAddress(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const body = assertValid(overrideAddressSchema, req.body || {});
  const result = await orderAddressValidationService.overrideAddressValidation(orderId, body, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function assignStaff(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const { assignedStaffIds } = assertValid(assignStaffSchema, req.body);
  const result = await orderAssignmentService.assignStaff(orderId, assignedStaffIds, auditAuth(req));

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function requestOrderItemPsd(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const body = assertValid(requestDesignFileSchema, req.body || {});
  const result = await orderDesignRequestService.requestPsdForOrderItem(orderItemId, body, auditAuth(req));

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function listOrderItemTimeline(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const query = assertValid(paginationQuerySchema, req.query);
  const result = await orderQueryService.listOrderItemTimeline(orderItemId, query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedOrderTimelineDto(result) });
}

module.exports = {
  listOrders,
  exportOrdersCsv,
  listOrderWorkbench,
  listCustomerExceptions,
  getOrderSummary,
  getOrder,
  getExpandedOrder,
  listOrderItems,
  getOrderItem,
  getOrderItemReadiness,
  requestOrderItemPsd,
  markFulfillmentReady,
  recheckOrderItem,
  createReplacementForItem,
  createReplacementForOrder,
  cancelOrderItem,
  updateShippingAddress,
  updateBuyer,
  updateShippingService,
  updateOrderItemCsNote,
  listOrderCases,
  getOrderCase,
  createOrderCase,
  updateOrderCase,
  resolveOrderCase,
  cancelOrderCase,
  addOrderCaseComment,
  validateAddress,
  overrideAddress,
  assignStaff,
  listOrderTimeline,
  listOrderItemTimeline,
};
