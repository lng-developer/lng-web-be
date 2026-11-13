const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');

function normalizeLngGroupTracking(externalOrderId, payload = {}) {
  const order = payload.data || payload;
  const packageInfo = (order.packages || []).find((entry) => cleanString(entry?.trackingNumber))
    || order.packages?.[0]
    || {};
  return {
    provider: 'LNG_GROUP',
    externalOrderId,
    carrier: cleanString(packageInfo.carrier),
    trackingNumber: cleanString(packageInfo.trackingNumber),
    trackingUrl: cleanString(packageInfo.trackingUrl),
    vendorStatus: cleanString(packageInfo.status).toUpperCase(),
    rawStatus: cleanString(packageInfo.status),
    shippedAt: cleanString(packageInfo.shippedAt),
  };
}

module.exports = Object.freeze({
  normalizeLngGroupTracking,

  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId, { credential } = {}) {
    const baseUrl = credential?.baseUrl;
    const token = credential?.accessToken;
    if (!baseUrl || !token) {
      const error = new Error('LNG Group tracking credentials are not configured');
      error.vendorHttpStatus = null;
      throw error;
    }

    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/portal/orders/${encodeURIComponent(externalOrderId)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      const error = new Error('LNG Group tracking request failed');
      error.vendorHttpStatus = response.status;
      error.vendorMessage = payload?.error?.message || payload?.message || null;
      throw error;
    }

    return normalizeLngGroupTracking(externalOrderId, payload);
  },
});
