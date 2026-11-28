const {
  cleanString,
  normalizeVendorTrackingPayload,
} = require('../vendorTrackingNormalizer.service');
const requestJson = require('./requestJson');

function matchingOrder(externalOrderId, payload, vendorOrderCode) {
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data || payload];
  const matches = rows.filter((row) => {
    const reference = cleanString(row?.external_number || row?.externalNumber || row?.external_order_number || row?.externalOrderNumber);
    if (reference && externalOrderId !== vendorOrderCode) return reference === externalOrderId;
    return Boolean(vendorOrderCode && cleanString(row?.code) === vendorOrderCode)
      || cleanString(row?.code) === externalOrderId;
  });
  if (matches.length > 1) throw new Error('MERCHIZE order response is ambiguous');
  return matches[0] || {};
}

function normalizeMerchizeTracking(externalOrderId, payload = {}, vendorOrderCode) {
  const row = matchingOrder(externalOrderId, payload, vendorOrderCode);
  const status = cleanString(row?.order_status || row?.production_status || row?.shipment_status || row?.status);
  const shippedAt = cleanString(row?.created || row?.updated || row?.shipped_at || row?.shippedAt);
  return {
    provider: 'MERCHIZE',
    externalOrderId,
    vendorOrderCode: cleanString(row?.code) || null,
    carrier: cleanString(row?.tracking_company || row?.carrier),
    trackingNumber: cleanString(row?.tracking_number || row?.trackingNumber),
    trackingUrl: cleanString(row?.tracking_url || row?.trackingUrl),
    shippedAt: shippedAt || null,
    vendorStatus: status.toUpperCase(),
    rawStatus: status,
  };
}

function normalizeMerchizeOrderDetail(externalOrderId, payload = {}, vendorOrderCode) {
  const row = matchingOrder(externalOrderId, payload, vendorOrderCode);
  const shipment = Array.isArray(row?.shipment_statuses) && row.shipment_statuses.length > 0
    ? row.shipment_statuses[0]
    : {};
  const status = cleanString(row?.order_status || row?.production_status || row?.status || shipment?.status || shipment?.shipment_status);
  const shippedAt = cleanString(
    shipment?.created
    || shipment?.updated
    || shipment?.shipped_at
    || shipment?.shippedAt
    || row?.created
    || row?.updated
    || row?.shipped_at
    || row?.shippedAt,
  );

  return {
    provider: 'MERCHIZE',
    externalOrderId,
    vendorOrderCode: cleanString(row?.code) || null,
    carrier: cleanString(shipment?.tracking_company || shipment?.carrier || row?.tracking_company || row?.carrier),
    trackingNumber: cleanString(shipment?.tracking_number || shipment?.trackingNumber || row?.tracking_number || row?.trackingNumber),
    trackingUrl: cleanString(shipment?.tracking_url || shipment?.trackingUrl || row?.tracking_url || row?.trackingUrl),
    shippedAt: shippedAt || null,
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

    const vendorOrderCode = cleanString(options.vendorOrderCode)
      || (/^R[A-Z0-9]-/i.test(externalOrderId) ? externalOrderId : '');
    const reference = orderNumber && !/^[a-f0-9]{24}$/i.test(orderNumber)
      && orderNumber !== vendorOrderCode ? orderNumber : '';
    if (!reference && !vendorOrderCode) throw new Error('MERCHIZE order reference is missing');
    const candidateOrders = reference
      ? [{ code: '', external_number: reference, identifier }]
      : [{ code: vendorOrderCode, external_number: '', identifier: '' }];

    const trackingUrl = new URL(
      credential?.trackingEndpointUrl || `${baseUrl.replace(/\/+$/, '')}/order/external/orders/list-orders-tracking`,
    );
    const result = await requestJson(trackingUrl, {
      method: 'POST',
      token,
      ...(options.signal && { signal: options.signal }),
      body: { orders: candidateOrders },
    });

    const tracking = normalizeMerchizeTracking(reference || vendorOrderCode, result.json || {}, vendorOrderCode);
    const trackingOk = result.statusCode >= 200 && result.statusCode < 300 && result.json?.success !== false;
    if (trackingOk && tracking.trackingNumber && tracking.vendorOrderCode) return tracking;

    const detailUrl = new URL(`${baseUrl.replace(/\/+$/, '')}/order/external/orders/list-orders-detail`);
    let detailResult;
    try {
      detailResult = await requestJson(detailUrl, {
        method: 'POST',
        token,
        ...(options.signal && { signal: options.signal }),
        body: { orders: candidateOrders },
      });
    } catch (error) {
      if (trackingOk && tracking.trackingNumber) return tracking;
      throw error;
    }

    if (
      detailResult.statusCode >= 200
      && detailResult.statusCode < 300
      && detailResult.json?.success !== false
      && Array.isArray(detailResult.json?.data)
      && detailResult.json.data.length > 0
    ) {
      const detail = normalizeMerchizeOrderDetail(reference || vendorOrderCode, detailResult.json, vendorOrderCode);
      if (trackingOk && tracking.trackingNumber) return { ...tracking, vendorOrderCode: detail.vendorOrderCode || tracking.vendorOrderCode };
      return detail;
    }

    if (result.statusCode < 200 || result.statusCode >= 300 || result.json?.success === false) {
      const error = new Error('MERCHIZE tracking request failed');
      error.vendorHttpStatus = result.statusCode;
      error.vendorMessage = result.json?.message || result.json?.error || null;
      throw error;
    }

    return tracking;
  },
});
