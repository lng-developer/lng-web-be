const shipmentStatuses = Object.freeze({
  TRACKING_PENDING: 'TRACKING_PENDING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  EXCEPTION: 'EXCEPTION',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
});

const marketplaceConfirmationStatuses = Object.freeze({
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
});

const shipmentPermissions = Object.freeze({
  READ: 'SHIPMENTS:READ',
  WRITE: 'SHIPMENTS:WRITE',
});

const vendorWebhookOutcomes = Object.freeze({
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  SKIPPED: 'SKIPPED',
});

module.exports = {
  marketplaceConfirmationStatuses,
  shipmentPermissions,
  shipmentStatuses,
  vendorWebhookOutcomes,
};
