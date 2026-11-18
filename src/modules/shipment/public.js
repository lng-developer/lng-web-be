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
  findByIds(...args) {
    return service().findByIds(...args);
  },
  findReadyForMarketplaceUpload(...args) {
    return service().findReadyForMarketplaceUpload(...args);
  },
  findShippedByShop(...args) {
    return service().findShippedByShop(...args);
  },
  updateMarketplaceConfirmation(...args) {
    return service().updateMarketplaceConfirmation(...args);
  },
  updateStatus(...args) { return service().updateStatus(...args); },
  normalizeTrackingForAmazon(input, options) {
    const amazonCarrierNormalization = require('./services/amazonCarrierNormalization.service');
    return amazonCarrierNormalization.normalizeForAmazon(input, options);
  },
  getVendorTrackingAdapter(provider) {
    const adapter = getTrackingAdapter(provider);
    return adapter === genericTrackingAdapter ? null : adapter;
  },
};

module.exports = publicPort;
