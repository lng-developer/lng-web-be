const orderStatuses = Object.freeze({
  IMPORTED: 'IMPORTED',
  ON_HOLD: 'ON_HOLD',
  PROCESSING: 'PROCESSING',
  PARTIALLY_SHIPPED: 'PARTIALLY_SHIPPED',
  SHIPPED: 'SHIPPED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
});

const orderItemStatuses = Object.freeze({
  NEW: 'NEW',
  MAPPING_PENDING: 'MAPPING_PENDING',
  CUSTOMIZATION_PENDING: 'CUSTOMIZATION_PENDING',
  CUSTOMIZATION_PARSED: 'CUSTOMIZATION_PARSED',
  FULFILLMENT_PLANNING: 'FULFILLMENT_PLANNING',
  FULFILLMENT_READY: 'FULFILLMENT_READY',
  NEED_PRODUCTION: 'NEED_PRODUCTION',
  IN_PRODUCTION: 'IN_PRODUCTION',
  QC_REJECTED: 'QC_REJECTED',
  READY_TO_SEND_VENDOR: 'READY_TO_SEND_VENDOR',
  SENT_TO_VENDOR: 'SENT_TO_VENDOR',
  TRACKING_PENDING: 'TRACKING_PENDING',
  SHIPPED: 'SHIPPED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
});

const addressValidationStatuses = Object.freeze({
  NOT_CHECKED: 'NOT_CHECKED',
  VALID: 'VALID',
  INVALID: 'INVALID',
  WARNING: 'WARNING',
  OVERRIDDEN: 'OVERRIDDEN',
});

const orderListTabs = Object.freeze({
  ALL: 'ALL',
  NEW_ORDER: 'NEW_ORDER',
  NO_COST_CENTER: 'NO_COST_CENTER',
  NO_PSD: 'NO_PSD',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  OPEN_CASE: 'OPEN_CASE',
});

const costCenterStatuses = Object.freeze({
  MISSING: 'MISSING',
  PRESENT: 'PRESENT',
});

const psdStatuses = Object.freeze({
  MISSING: 'MISSING',
  PRESENT: 'PRESENT',
});

const paymentStatuses = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  UNKNOWN: 'UNKNOWN',
});

const caseStatuses = Object.freeze({
  NONE: 'NONE',
  OPEN: 'OPEN',
});

module.exports = {
  orderStatuses,
  orderItemStatuses,
  addressValidationStatuses,
  orderListTabs,
  costCenterStatuses,
  psdStatuses,
  paymentStatuses,
  caseStatuses,
};
