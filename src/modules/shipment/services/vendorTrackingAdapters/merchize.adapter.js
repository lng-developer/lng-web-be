const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');
const requestJson = require('./requestJson');

function normalizeMerchizeTracking(externalOrderId, payload = {}) {
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data || payload];
  const row = rows.find((entry) => (
    cleanString(entry?.external_number) === externalOrderId
    || cleanString(entry?.externalNumber) === externalOrderId
    || cleanString(entry?.external_order_number) === externalOrderId
    || cleanString(entry?.externalOrderNumber) === externalOrderId
    || cleanString(entry?.code) === externalOrderId
    || cleanString(entry?._id) === externalOrderId
  )) || {};
  const status = cleanString(row?.order_status || row?.production_status || row?.shipment_status || row?.status);
  return {
    provider: 'MERCHIZE',
    externalOrderId,
    carrier: cleanString(row?.tracking_company || row?.carrier),
    trackingNumber: cleanString(row?.tracking_number || row?.trackingNumber),
    trackingUrl: cleanString(row?.tracking_url || row?.trackingUrl),
    vendorStatus: status.toUpperCase(),
    rawStatus: status,
  };
}

function normalizeMerchizeOrderDetail(externalOrderId, payload = {}) {
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data || payload];
  const row = rows.find((entry) => (
    cleanString(entry?.external_number) === externalOrderId
    || cleanString(entry?.externalNumber) === externalOrderId
    || cleanString(entry?.external_order_number) === externalOrderId
    || cleanString(entry?.externalOrderNumber) === externalOrderId
    || cleanString(entry?.code) === externalOrderId
    || cleanString(entry?._id) === externalOrderId
  )) || {};

  const shipment = Array.isArray(row?.shipment_statuses) && row.shipment_statuses.length > 0
    ? row.shipment_statuses[0]
    : {};
  const status = cleanString(row?.order_status || row?.production_status || row?.status || shipment?.status || shipment?.shipment_status);

  return {
    provider: 'MERCHIZE',
    externalOrderId,
    carrier: cleanString(shipment?.tracking_company || shipment?.carrier || row?.tracking_company || row?.carrier),
    trackingNumber: cleanString(shipment?.tracking_number || shipment?.trackingNumber || row?.tracking_number || row?.trackingNumber),
    trackingUrl: cleanString(shipment?.tracking_url || shipment?.trackingUrl || row?.tracking_url || row?.trackingUrl),
    vendorStatus: status.toUpperCase(),
    rawStatus: status,
  };
}

module.exports = Object.freeze({
  normalizeMerchizeTracking,
  normalizeMerchizeOrderDetail,

  normalizeTracking(provider, payload) {
    return normalizeVendorTrackingPayload(provider, payload);
  },

  async fetchTrackingByExternalOrderId(externalOrderId, options = {}) {
    const credential = options.credential;
    const baseUrl = credential?.baseUrl;
    const token = credential?.accessToken;
    if (!baseUrl || !token) {
      const error = new Error('MERCHIZE tracking credentials are not configured');
      error.vendorHttpStatus = null;
      throw error;
    }

    const identifier = cleanString(credential?.metadata?.identifier || process.env.MERCHIZE_IDENTIFIER || 'lng-web-be');
    const orderNumber = cleanString(options.orderExternalOrderId || options.externalOrderId || externalOrderId);

    const candidateOrders = [];
    if (/^R[A-Z0-9]-/i.test(externalOrderId)) {
      candidateOrders.push({ code: externalOrderId, external_number: '', identifier: '' });
    }
    if (orderNumber) {
      candidateOrders.push({ code: '', external_number: orderNumber, identifier });
    }
    if (externalOrderId && externalOrderId !== orderNumber && !candidateOrders.some((c) => c.code === externalOrderId)) {
      candidateOrders.push({ code: externalOrderId, external_number: '', identifier: '' });
    }
    if (candidateOrders.length === 0) {
      candidateOrders.push({ code: '', external_number: externalOrderId, identifier });
    }

    const trackingUrl = new URL(
      credential?.trackingEndpointUrl || `${baseUrl.replace(/\/+$/, '')}/order/external/orders/list-orders-tracking`,
    );
    const result = await requestJson(trackingUrl, {
      method: 'POST',
      token,
      body: { orders: candidateOrders },
    });

    const hasTrackingRows = result.statusCode >= 200 && result.statusCode < 300
      && result.json?.success !== false
      && Array.isArray(result.json?.data)
      && result.json.data.some((entry) => cleanString(entry?.tracking_number || entry?.trackingNumber));

    if (hasTrackingRows) {
      return normalizeMerchizeTracking(orderNumber, result.json || {});
    }

    const detailUrl = new URL(`${baseUrl.replace(/\/+$/, '')}/order/external/orders/list-orders-detail`);
    const detailResult = await requestJson(detailUrl, {
      method: 'POST',
      token,
      body: { orders: candidateOrders },
    });

    if (
      detailResult.statusCode >= 200
      && detailResult.statusCode < 300
      && detailResult.json?.success !== false
      && Array.isArray(detailResult.json?.data)
      && detailResult.json.data.length > 0
    ) {
      return normalizeMerchizeOrderDetail(orderNumber, detailResult.json);
    }

    if (result.statusCode < 200 || result.statusCode >= 300 || result.json?.success === false) {
      const error = new Error('MERCHIZE tracking request failed');
      error.vendorHttpStatus = result.statusCode;
      error.vendorMessage = result.json?.message || result.json?.error || null;
      throw error;
    }

    return normalizeMerchizeTracking(orderNumber, result.json || {});
  },
});
