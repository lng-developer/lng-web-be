const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');
const requestJson = require('./requestJson');

function normalizeMerchizeTracking(externalOrderId, payload = {}) {
  const row = Array.isArray(payload.data) ? payload.data[0] : payload.data || payload;
  return {
    provider: 'MERCHIZE',
    externalOrderId,
    carrier: cleanString(row?.tracking_company || row?.carrier),
    trackingNumber: cleanString(row?.tracking_number || row?.trackingNumber),
    trackingUrl: cleanString(row?.tracking_url || row?.trackingUrl),
    vendorStatus: cleanString(row?.shipment_status || row?.status).toUpperCase(),
    rawStatus: cleanString(row?.status || row?.shipment_status),
  };
}

module.exports = Object.freeze({
  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId, { credential } = {}) {
    const baseUrl = credential?.baseUrl;
    const token = credential?.accessToken;
    if (!baseUrl || !token) {
      const error = new Error('MERCHIZE tracking credentials are not configured');
      error.vendorHttpStatus = null;
      throw error;
    }

    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/order/external/orders/tracking`);
    url.searchParams.set('external_number', externalOrderId);
    const result = await requestJson(url, { method: 'GET', token });
    if (result.statusCode < 200 || result.statusCode >= 300 || result.json?.success === false) {
      const error = new Error('MERCHIZE tracking request failed');
      error.vendorHttpStatus = result.statusCode;
      error.vendorMessage = result.json?.message || result.json?.error || null;
      throw error;
    }

    return normalizeMerchizeTracking(externalOrderId, result.json || {});
  },
});
