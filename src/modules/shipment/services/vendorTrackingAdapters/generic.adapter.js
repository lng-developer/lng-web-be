const { normalizeVendorTrackingPayload } = require('../vendorTrackingNormalizer.service');

module.exports = Object.freeze({
  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },
});
