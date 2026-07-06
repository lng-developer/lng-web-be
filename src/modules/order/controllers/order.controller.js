const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const orderQueryService = require('../services/orderQuery.service');
const orderAddressValidationService = require('../services/orderAddressValidation.service');
const orderReadinessService = require('../services/orderReadiness.service');
const orderAssignmentService = require('../services/orderAssignment.service');
const orderOperationsService = require('../services/orderOperations.service');
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
  listOrdersQuerySchema,
  orderIdParamSchema,
  listOrderItemsQuerySchema,
  orderItemIdParamSchema,
  paginationQuerySchema,
  buyerSchema,
  caseStatusSchema,
  shippingAddressSchema,
  shippingServiceSchema,
  assignStaffSchema,
  validate,
} = require('../validators/order.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
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
  const result = await orderReadinessService.markFulfillmentReady(orderItemId, req.auth);

  res.status(httpStatus.OK).json({
    success: true,
    data: {
      item: toOrderItemDto(result.item),
      readiness: result.readiness,
    },
  });
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
  const result = await orderAddressValidationService.updateShippingAddress(orderId, body, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function updateBuyer(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const body = assertValid(buyerSchema, req.body);
  const result = await orderOperationsService.updateBuyer(orderId, body, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function updateShippingService(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const body = assertValid(shippingServiceSchema, req.body);
  const result = await orderOperationsService.updateShippingService(orderId, body, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function updateCaseStatus(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const { caseStatus } = assertValid(caseStatusSchema, req.body);
  const result = await orderOperationsService.updateCaseStatus(orderId, caseStatus, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function validateAddress(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const result = await orderAddressValidationService.validateAddressForOrder(orderId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function assignStaff(req, res) {
  const { orderId } = assertValid(orderIdParamSchema, req.params);
  const { assignedStaffId } = assertValid(assignStaffSchema, req.body);
  const result = await orderAssignmentService.assignStaff(orderId, assignedStaffId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toOrderDto(result) });
}

async function listOrderItemTimeline(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const query = assertValid(paginationQuerySchema, req.query);
  const result = await orderQueryService.listOrderItemTimeline(orderItemId, query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedOrderTimelineDto(result) });
}

module.exports = {
  listOrders,
  listOrderWorkbench,
  getOrderSummary,
  getOrder,
  getExpandedOrder,
  listOrderItems,
  getOrderItem,
  getOrderItemReadiness,
  markFulfillmentReady,
  updateShippingAddress,
  updateBuyer,
  updateShippingService,
  updateCaseStatus,
  validateAddress,
  assignStaff,
  listOrderTimeline,
  listOrderItemTimeline,
};
