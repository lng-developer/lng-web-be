const shipmentStatuses = Object.freeze({
  TRACKING_PENDING: 'TRACKING_PENDING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  EXCEPTION: 'EXCEPTION',
  CANCELLED: 'CANCELLED',
});

const shipmentPermissions = Object.freeze({
  READ: 'SHIPMENTS:READ',
  WRITE: 'SHIPMENTS:WRITE',
});

module.exports = {
  shipmentPermissions,
  shipmentStatuses,
};
