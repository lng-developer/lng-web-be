const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');

function normalizeMerchfoxTracking(externalOrderId, payload = {}) {
  const order = payload.data || {};
  const tracking = order.tracking || {};
  return {
    provider: 'MERCHFOX',
    externalOrderId,
    carrier: cleanString(tracking.carrier),
    trackingNumber: cleanString(tracking.number),
    trackingUrl: cleanString(tracking.url),
    vendorStatus: cleanString(order.status).toUpperCase(),
    rawStatus: cleanString(order.status),
  };
}

module.exports = Object.freeze({
  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId, { credential } = {}) {
    const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
    const apiKey = credential?.apiKey;
    const apiSecret = credential?.apiSecret;
    if (!baseUrl || !apiKey || !apiSecret) {
      throw new Error('MERCHFOX tracking credentials are not configured');
    }
    const response = await fetch(`${baseUrl}/api/v1/orders/${encodeURIComponent(externalOrderId)}`, {
      headers: { Accept: 'application/json', 'X-Mfx-App-Key': apiKey, 'X-Mfx-App-Secret': apiSecret },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.code !== 0) {
      const error = new Error('MERCHFOX tracking request failed');
      error.vendorHttpStatus = response.status;
      error.vendorMessage = body.message || null;
      throw error;
    }
    return normalizeMerchfoxTracking(externalOrderId, body);
  },
});
