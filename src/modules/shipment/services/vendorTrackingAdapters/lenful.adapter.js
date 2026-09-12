const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');
const requestJson = require('./requestJson');

function normalizeLenfulTracking(externalOrderId, payload = {}) {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const row = rows.find((entry) => cleanString(entry?.order_number) === externalOrderId) || {};
  return {
    provider: 'LENFUL',
    externalOrderId,
    carrier: cleanString(row.company || row.translation?.name),
    trackingNumber: cleanString(row.number || row.tracking_number || row.trackingNumber),
    trackingUrl: cleanString(row.tracking_url || row.trackingUrl),
    vendorStatus: cleanString(row.status).toUpperCase(),
    rawStatus: cleanString(row.status),
  };
}

module.exports = Object.freeze({
  normalizeLenfulTracking,

  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId, { credential } = {}) {
    const baseUrl = credential?.baseUrl;
    const token = credential?.accessToken;
    if (!baseUrl || !token) {
      const error = new Error('LENFUL tracking credentials are not configured');
      error.vendorHttpStatus = null;
      throw error;
    }

    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/order/trackings`);
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', String(process.env.LENFUL_TRACKING_LIMIT || 50));
    url.searchParams.set('keyword', externalOrderId);
    url.searchParams.set('keyword_type', 'order');
    url.searchParams.set('sort_by', 'create_at_desc');
    const result = await requestJson(url, { method: 'GET', token });
    if (result.statusCode < 200 || result.statusCode >= 300 || result.json?.success === false) {
      const error = new Error('LENFUL tracking request failed');
      error.vendorHttpStatus = result.statusCode;
      error.vendorMessage = result.json?.message || result.json?.error || null;
      throw error;
    }

    return normalizeLenfulTracking(externalOrderId, result.json || {});
  },
});
