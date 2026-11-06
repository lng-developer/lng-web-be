const { cleanString, normalizeVendorTrackingPayload } = require('../vendorTrackingNormalizer.service');

function normalizeMangoteeTracking(externalOrderId, payload = {}) {
  const data = payload.data || payload;
  const trackingNumber = data.tracking_number || data.trackingNumber;
  const vendorStatus = cleanString(data.tracking_status || data.trackingStatus || data.status).toUpperCase();
  const shippedAt = data.shipped_at
    || data.shippedAt
    || data.fulfilled_at
    || data.fulfilledAt
    || (['SHIPPED', 'FULFILLED', 'COMPLETED', 'DELIVERED'].includes(vendorStatus) || trackingNumber
      ? data.updated_at || data.updatedAt
      : null);
  const normalized = normalizeVendorTrackingPayload('MANGOTEE', {
    ...payload,
    data: {
      ...data,
      order_id: data.order_id || externalOrderId,
      tracking_number: trackingNumber,
      tracking_status: data.tracking_status || data.trackingStatus,
      tracking_provider: data.tracking_provider || data.trackingProvider,
    },
  });
  return {
    ...normalized,
    provider: 'MANGOTEE',
    externalOrderId,
    carrier: cleanString(data.tracking_provider || data.trackingProvider || data.carrier),
    vendorStatus,
    shippedAt: shippedAt || (normalized.trackingNumber ? normalized.shippedAt : null),
  };
}

module.exports = Object.freeze({
  normalizeMangoteeTracking,
  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },
  async fetchTrackingByExternalOrderId(externalOrderId, { credential } = {}) {
    const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
    const apiKey = credential?.accessToken;
    if (!baseUrl || !apiKey) {
      const error = new Error('MANGOTEE tracking credentials are not configured');
      error.vendorHttpStatus = null;
      throw error;
    }

    const response = await fetch(`${baseUrl}/orders/${encodeURIComponent(externalOrderId)}`, {
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status === false) {
      const error = new Error('MANGOTEE tracking request failed');
      error.vendorHttpStatus = response.status;
      error.vendorMessage = body.message || body.error || null;
      throw error;
    }
    return normalizeMangoteeTracking(externalOrderId, body);
  },
});
