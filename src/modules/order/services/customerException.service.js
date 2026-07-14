const { orderItemStatuses, addressValidationStatuses, orderCaseTypes } = require('../constants/orderStatuses');
const orderQueryService = require('./orderQuery.service');

const terminalStatuses = new Set([
  orderItemStatuses.SHIPPED,
  orderItemStatuses.CANCELLED,
  orderItemStatuses.REFUNDED,
  orderItemStatuses.FAILED,
]);

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function buildException({ row, itemRow, reason, caseType, status, message }) {
  const order = row.order || {};
  const item = itemRow?.item || null;
  return {
    orderId: toId(order._id || order.id),
    orderItemId: item ? toId(item._id || item.id) : null,
    shopId: toId(order.shopId),
    externalOrderId: order.externalOrderId || null,
    sku: item?.sku || null,
    title: item?.title || null,
    caseType,
    reason,
    status,
    message,
    createdAt: item?.createdAt || order.createdAt || null,
  };
}

function collectRowExceptions(row = {}) {
  const exceptions = [];
  const order = row.order || {};

  if (order.addressValidationStatus === addressValidationStatuses.INVALID) {
    exceptions.push(buildException({
      row,
      reason: 'ADDRESS_INVALID',
      caseType: orderCaseTypes.ADDRESS,
      status: order.addressValidationStatus,
      message: 'Order shipping address is invalid',
    }));
  }

  if (order.caseStatus === 'OPEN') {
    exceptions.push(buildException({
      row,
      reason: 'OPEN_CASE',
      caseType: orderCaseTypes.OTHER,
      status: order.caseStatus,
      message: 'Order has an open CS case',
    }));
  }

  (row.items || []).forEach((itemRow) => {
    const item = itemRow.item || {};
    const customization = itemRow.customization || null;
    const hasCustomization = Boolean(item.customizationRawSummary?.hasCustomization);

    if (hasCustomization && (!customization || customization.status !== 'PARSED')) {
      exceptions.push(buildException({
        row,
        itemRow,
        reason: 'CUSTOMIZATION_NOT_READY',
        caseType: orderCaseTypes.CUSTOMIZATION,
        status: customization?.status || 'MISSING',
        message: 'Customization is not ready',
      }));
    }

    if (itemRow.tracking?.status === 'EXCEPTION') {
      exceptions.push(buildException({
        row,
        itemRow,
        reason: 'SHIPMENT_EXCEPTION',
        caseType: orderCaseTypes.SHIPMENT,
        status: itemRow.tracking.status,
        message: 'Shipment is in exception state',
      }));
    }

    if ((item.replacementOfOrderItemId || item.replacementOfOrderId || order.replacementOfOrderId)
      && !terminalStatuses.has(item.status)) {
      exceptions.push(buildException({
        row,
        itemRow,
        reason: 'REPLACEMENT_PENDING',
        caseType: orderCaseTypes.REPLACEMENT,
        status: item.status || null,
        message: 'Replacement order item is still pending',
      }));
    }

    if ([orderItemStatuses.CANCELLED, orderItemStatuses.REFUNDED].includes(item.status)) {
      exceptions.push(buildException({
        row,
        itemRow,
        reason: item.status === orderItemStatuses.REFUNDED ? 'REFUND_RELATED' : 'CANCELLED_ITEM',
        caseType: item.status === orderItemStatuses.REFUNDED ? orderCaseTypes.REFUND : orderCaseTypes.OTHER,
        status: item.status,
        message: item.status === orderItemStatuses.REFUNDED ? 'Order item is refunded' : 'Order item is cancelled',
      }));
    }
  });

  return exceptions;
}

function matchesQuery(exception, query = {}) {
  if (query.reason && exception.reason !== query.reason) return false;
  if (query.status && exception.status !== query.status) return false;
  if (query.caseType && exception.caseType !== query.caseType) return false;
  return true;
}

async function listCustomerExceptions(query = {}, authContext = {}) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  const workbench = await orderQueryService.listOrderWorkbench({
    ...query,
    page,
    limit,
  }, authContext);
  const items = (workbench.items || [])
    .flatMap(collectRowExceptions)
    .filter((exception) => matchesQuery(exception, query));

  return {
    items,
    total: items.length,
    page,
    limit,
  };
}

module.exports = {
  listCustomerExceptions,
};
