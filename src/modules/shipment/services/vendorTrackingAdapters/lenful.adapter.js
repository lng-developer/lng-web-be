const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');
const requestJson = require('./requestJson');

function normalizeLenfulTracking(externalOrderId, payload = {}) {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const row = rows.find((entry) => cleanString(entry?.order_number) === externalOrderId) || rows[0] || {};
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

async function runtimeCredential() {
  if (process.env.NODE_ENV === 'test' && process.env.ENABLE_VENDOR_DB_CREDENTIALS_IN_TEST !== 'true') return null;
  try {
    const vendorPublic = require('../../../vendor/public');
    return await vendorPublic.getVendorIntegrationCredential('LENFUL');
  } catch (error) {
    return null;
  }
}

module.exports = Object.freeze({
  normalizeLenfulTracking,

  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId) {
    const credential = await runtimeCredential();
    const baseUrl = credential?.baseUrl || process.env.LENFUL_API_BASE_URL;
    const token = credential?.accessToken || process.env.LENFUL_ACCESS_TOKEN || process.env.LENFUL_API_KEY || process.env.LENFUL_TOKEN;
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
    const result = await requestJson(url, token);
    if (result.statusCode < 200 || result.statusCode >= 300 || result.json?.success === false) {
      const error = new Error('LENFUL tracking request failed');
      error.vendorHttpStatus = result.statusCode;
      error.vendorMessage = result.json?.message || result.json?.error || null;
      throw error;
    }

    return normalizeLenfulTracking(externalOrderId, result.json || {});
  },
});
