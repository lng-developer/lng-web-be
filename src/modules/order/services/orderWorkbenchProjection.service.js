const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const repository = require('../repositories/orderWorkbenchProjection.repository');

const ITEM_PATCH_FIELDS = new Set([
  'item.status', 'seller', 'listing', 'customization', 'fulfillmentPlan', 'listingVariant', 'production', 'tracking',
]);
const ORDER_PATCH_FIELDS = new Set([
  'order.status', 'order.caseStatus', 'order.psdStatus', 'order.costCenterStatus',
  'shop', 'case', 'shopId', 'orderedAt', 'status', 'caseStatus', 'psdStatus', 'costCenterStatus', 'hasCurrentPsd',
]);
const ORDER_FIELDS = [
  '_id', 'id', 'externalOrderId', 'createdAt', 'orderedAt', 'shipByDate', 'deliveredAt', 'status', 'psdStatus', 'paymentStatus',
  'buyer', 'totalAmount', 'currency', 'costCenterStatus', 'shopId', 'replacementOfOrderId',
  'replacementOfOrderItemId', 'replacementSequence', 'replacementReason', 'salesChannelCode',
  'marketplaceCode', 'externalAccountId', 'addressValidationStatus', 'shippingAddress', 'shippingService', 'caseStatus',
  'assignedStaffIds',
];
const ITEM_FIELDS = [
  '_id', 'id', 'orderId', 'externalItemId', 'sku', 'title', 'asin', 'quantity', 'status', 'csNote',
  'listingId', 'replacementOfOrderId', 'replacementOfOrderItemId', 'replacementSequence',
  'replacementReason', 'price',
];

function validationError(message, details) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
}

function pick(source = {}, fields = []) {
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]]));
}

function assertPatchFields(patch = {}, allowedFields, subject) {
  const invalidFields = Object.keys(patch).filter((field) => !allowedFields.has(field));
  if (invalidFields.length) {
    throw validationError(`Invalid ${subject} projection fields`, { invalidFields });
  }
}

function hasCurrentPsd(items = []) {
  return items.length > 0 && items.every(({ listingVariant, listing }) => {
    if (listingVariant?.psdReadiness) return listingVariant.psdReadiness.status !== 'MISSING';
    return Boolean(listing?.defaultPsdTemplateAssetId);
  });
}

function buildBaseProjection(order, items = []) {
  if (!order?._id && !order?.id) throw validationError('Order id is required for Workbench projection');
  if (!order?.shopId) throw validationError('Shop id is required for Workbench projection');

  const orderId = order._id || order.id;
  return {
    orderId,
    shopId: order.shopId,
    externalOrderId: order.externalOrderId,
    salesChannelCode: order.salesChannelCode || null,
    marketplaceCode: order.marketplaceCode || null,
    externalAccountId: order.externalAccountId || null,
    assignedStaffIds: order.assignedStaffIds || [],
    sourceCreatedAt: order.createdAt || null,
    sourceUpdatedAt: order.updatedAt || null,
    orderedAt: order.orderedAt || null,
    shipByDate: order.shipByDate || null,
    deliveredAt: order.deliveredAt || null,
    status: order.status || null,
    costCenterStatus: order.costCenterStatus || null,
    psdStatus: order.psdStatus || null,
    hasCurrentPsd: false,
    paymentStatus: order.paymentStatus || null,
    addressValidationStatus: order.addressValidationStatus || null,
    caseStatus: order.caseStatus || null,
    order: pick(order, ORDER_FIELDS),
    shop: null,
    case: null,
    items: (items || []).map((item) => ({
      orderItemId: item._id || item.id,
      item: pick(item, ITEM_FIELDS),
      seller: null,
      listing: null,
      customization: null,
      fulfillmentPlan: null,
      listingVariant: null,
      production: null,
      tracking: null,
    })),
  };
}

async function upsertOrderWorkbenchBase(order, items = [], options = {}) {
  return repository.upsertBase(buildBaseProjection(order, items), options);
}

async function upsertOrderWorkbenchRow(row = {}, options = {}) {
  const projection = buildBaseProjection(row.order, (row.items || []).map(({ item }) => item));
  projection.shop = row.shop || null;
  projection.case = row.case || null;
  projection.items = projection.items.map((entry, index) => ({
    ...entry,
    ...Object.fromEntries(Object.entries(row.items?.[index] || {})
      .filter(([key]) => key !== 'item' && key !== 'orderItemId')),
  }));
  projection.hasCurrentPsd = hasCurrentPsd(row.items || []);
  return repository.upsertBase(projection, options);
}

async function updateOrderWorkbenchOrder(orderId, patch = {}, options = {}) {
  assertPatchFields(patch, ORDER_PATCH_FIELDS, 'order');
  return repository.setOrderFields(orderId, patch, options);
}

async function updateOrderWorkbenchItem(orderId, orderItemId, patch = {}, options = {}) {
  assertPatchFields(patch, ITEM_PATCH_FIELDS, 'item');
  return repository.setItemFields(orderId, orderItemId, patch, options);
}

module.exports = {
  upsertOrderWorkbenchBase,
  upsertOrderWorkbenchRow,
  updateOrderWorkbenchOrder,
  updateOrderWorkbenchItem,
};
