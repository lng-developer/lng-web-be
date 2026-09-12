const service = require('./services/shipment.service');
const { shipmentPermissions } = require('./constants/shipment.constants');
const { getTrackingAdapter } = require('./services/vendorTrackingAdapterRegistry.service');
const genericTrackingAdapter = require('./services/vendorTrackingAdapters/generic.adapter');

const publicPort = {
  ensureFromVendorSubmission(vendorSubmissionId, authContext = {}) {
    return service.createFromVendorSubmission(vendorSubmissionId, {
      ...authContext,
      permissions: [...new Set([...(authContext.permissions || []), shipmentPermissions.WRITE])],
      system: true,
      source: authContext.source || 'SYSTEM',
    });
  },
  getShipmentByOrderItem: service.getShipmentByOrderItem,
  listSummariesByOrderItemIds: service.listSummariesByOrderItemIds,
  summarizeShippedByOrderItemIds: service.summarizeShippedByOrderItemIds,
  summarizeShipments: service.summarizeShipments,
  getVendorTrackingAdapter(provider) {
    const adapter = getTrackingAdapter(provider);
    return adapter === genericTrackingAdapter ? null : adapter;
  },
};

module.exports = publicPort;
