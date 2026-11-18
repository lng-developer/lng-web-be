const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');

function normalizeLngGroupTracking(externalOrderId, payload = {}) {
  const order = payload.data || payload;
  const shipment = order.shipment || {};
  const packageInfo = (order.packages || []).find((entry) => cleanString(entry?.trackingNumber))
    || order.packages?.[0]
    || {};
  return {
    provider: 'LNG_GROUP',
    externalOrderId: cleanString(order.externalOrderId || externalOrderId),
    vendorExternalOrderId: cleanString(order.fulfillmentOrderId || order.vendorExternalOrderId),
    carrier: cleanString(shipment.carrierCode || order.carrierCode || order.carrier || packageInfo.carrier),
    trackingNumber: cleanString(shipment.trackingNumber || order.trackingNumber || packageInfo.trackingNumber),
    trackingUrl: cleanString(shipment.labelUrl || packageInfo.trackingUrl || order.trackingUrl),
    vendorStatus: cleanString(shipment.status || packageInfo.status || order.orderStatus || order.eventType).toUpperCase(),
    rawStatus: cleanString(shipment.status || packageInfo.status || order.orderStatus || order.eventType),
    shippedAt: cleanString(
      shipment.actualShipAt
      || packageInfo.shippedAt
      || packageInfo.shipDate
      || packageInfo.shipdate
      || order.shippedAt
      || order.shipDate
      || order.shipdate
    ),
  };
}

module.exports = Object.freeze({
  normalizeLngGroupTracking,

  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId, { credential, orderExternalOrderId } = {}) {
    const baseUrl = credential?.baseUrl;
    const token = credential?.accessToken;
    if (!baseUrl || !token) {
      const error = new Error('LNG Group tracking credentials are not configured');
      error.vendorHttpStatus = null;
      throw error;
    }

    const targetOrderId = orderExternalOrderId || externalOrderId;
    let response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/portal/orders/${encodeURIComponent(targetOrderId)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    if (response.status === 404 && targetOrderId !== externalOrderId) {
      response = await fetch(
        `${baseUrl.replace(/\/+$/, '')}/api/portal/orders/${encodeURIComponent(externalOrderId)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );
    }
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
