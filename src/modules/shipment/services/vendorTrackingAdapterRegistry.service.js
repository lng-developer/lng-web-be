const { normalizeVendorTrackingPayload } = require('./vendorTrackingNormalizer.service');

const genericTrackingAdapter = Object.freeze({
  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },
});

function getTrackingAdapter() {
  return genericTrackingAdapter;
}

module.exports = {
  getTrackingAdapter,
};
