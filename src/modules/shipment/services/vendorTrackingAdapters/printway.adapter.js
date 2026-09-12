const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');
const requestJson = require('./requestJson');

function normalizePrintwayTracking(externalOrderId, payload = {}) {
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data || payload];
  const row = rows.find((entry) => (
    cleanString(entry?.order_name) === externalOrderId
    || cleanString(entry?.pw_order_id) === externalOrderId
  )) || {};
  const tracking = Array.isArray(row.trackings) ? row.trackings[0] || {} : row.trackings || {};
  return {
    provider: 'PRINTWAY',
    externalOrderId,
    carrier: cleanString(tracking.carrierName || tracking.carrierCode || tracking.carrier),
    trackingNumber: cleanString(tracking.trackingNumber || tracking.tracking_number),
    trackingUrl: cleanString(tracking.trackingUrl || tracking.tracking_url),
    vendorStatus: cleanString(row.shipment_status || row.status).toUpperCase(),
    rawStatus: cleanString(row.status || row.shipment_status),
  };
}

function formatPrintwayDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('-') + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function buildPrintwayOrderListBody(externalOrderId, options = {}) {
  const now = options instanceof Date ? options : new Date();
  const dateFrom = !(options instanceof Date) && options.dateFrom ? new Date(options.dateFrom) : null;
  const dateTo = !(options instanceof Date) && options.dateTo ? new Date(options.dateTo) : null;
  const defaultMin = new Date(now);
  defaultMin.setUTCFullYear(defaultMin.getUTCFullYear() - 2);
  return {
    created_at_min: process.env.PRINTWAY_TRACKING_CREATED_AT_MIN || formatPrintwayDate(dateFrom || defaultMin),
    created_at_max: process.env.PRINTWAY_TRACKING_CREATED_AT_MAX || formatPrintwayDate(dateTo || now),
    limit: Number(process.env.PRINTWAY_TRACKING_LIMIT || 1),
    page: Number(process.env.PRINTWAY_TRACKING_PAGE || 1),
    search: externalOrderId,
  };
}

module.exports = Object.freeze({
  buildPrintwayOrderListBody,
  normalizePrintwayTracking,

  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId, options = {}) {
    const { credential } = options;
    const baseUrl = credential?.baseUrl;
    const token = credential?.accessToken;
    if (!baseUrl || !token) {
      const error = new Error('PRINTWAY tracking credentials are not configured');
      error.vendorHttpStatus = null;
      throw error;
    }

    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v3/order/list`);
    const result = await requestJson(url, {
      method: 'POST', token, body: buildPrintwayOrderListBody(externalOrderId, options),
    });
    if (result.statusCode < 200 || result.statusCode >= 300 || result.json?.success === false) {
      const error = new Error('PRINTWAY tracking request failed');
      error.vendorHttpStatus = result.statusCode;
      error.vendorMessage = result.json?.message || result.json?.error || null;
      throw error;
    }

    return normalizePrintwayTracking(externalOrderId, result.json || {});
  },
});
