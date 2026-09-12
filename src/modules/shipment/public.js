const { shipmentPermissions } = require('./constants/shipment.constants');
const { getTrackingAdapter } = require('./services/vendorTrackingAdapterRegistry.service');
const genericTrackingAdapter = require('./services/vendorTrackingAdapters/generic.adapter');

const service = () => require('./services/shipment.service');

const publicPort = {
  ensureFromVendorSubmission(vendorSubmissionId, authContext = {}) {
    return service().createFromVendorSubmission(vendorSubmissionId, {
      ...authContext,
      permissions: [...new Set([...(authContext.permissions || []), shipmentPermissions.WRITE])],
      system: true,
      source: authContext.source || 'SYSTEM',
    });
  },
  getShipmentByOrderItem(...args) {
    return service().getShipmentByOrderItem(...args);
  },
  listSummariesByOrderItemIds(...args) {
    return service().listSummariesByOrderItemIds(...args);
  },
  summarizeShippedByOrderItemIds(...args) {
    return service().summarizeShippedByOrderItemIds(...args);
  },
  summarizeShipments(...args) {
    return service().summarizeShipments(...args);
  },
  getVendorTrackingAdapter(provider) {
    const adapter = getTrackingAdapter(provider);
    return adapter === genericTrackingAdapter ? null : adapter;
  },
};

module.exports = publicPort;
