const PROVIDER_ALIASES = Object.freeze([
  ['BEEFUL', ['beeful']],
  ['GRABINK', ['grabink']],
  ['MERCHFOX', ['merchfox', 'merch fox']],
  ['MERCHIZE', ['merchize']],
  ['PRINTWAY', ['printway', 'print way', 'pw']],
  ['MANGOTEE', ['mangotee', 'mango tee']],
  ['SS88', ['ss88', 'mmoseller']],
  ['LUXURY_PRO', ['luxurypro', 'luxury pro']],
  ['ONOSPOD', ['onos', 'onospod']],
  ['LENFUL', ['lenful']],
  ['PGPRINT', ['pgprint']],
  ['LNG_GROUP', ['lng']],
]);

function cleanString(value) {
  if (value === null || value === undefined || typeof value === 'object') return '';
  const result = String(value).trim();
  if (!result || /^\[object\s+Object\]$/i.test(result)) return '';
  return result;
}

function normalizeProviderKey(value) {
  const source = cleanString(value).toLowerCase();
  if (!source) return 'CUSTOM';
  const alias = PROVIDER_ALIASES.find(([, values]) => values.some((entry) => source.includes(entry)));
  return alias ? alias[0] : source.replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'CUSTOM';
}

function lower(value) {
  return cleanString(value).toLowerCase();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPayloadRoot(payload = {}) {
  if (isPlainObject(payload.data)) return payload.data;
  if (isPlainObject(payload.order)) return payload.order;
  return payload;
}

function firstValue(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function objectTrackingValue(value) {
  if (!isPlainObject(value)) return value;
  return firstValue(
    value.tracking_number,
    value.trackingNumber,
    value.tracking,
    value.tracking_code,
    value.trackingCode,
    value.tracking_id,
    value.trackingId,
    value.number,
    value.code,
  );
}

function objectCarrierValue(value) {
  if (!isPlainObject(value)) return '';
  return firstValue(
    value.carrier,
    value.carrier_name,
    value.carrierName,
    value.tracking_company,
    value.shipping_carrier,
    value.shippingCarrier,
    value.shipping_provider,
    value.shippingProvider,
  );
}

function isValidTrackingNumber(value) {
  const tracking = cleanString(value);
  if (!tracking || tracking === '-' || tracking === '---') return false;
  if (/^0+$/.test(tracking)) return false;
  return tracking.length >= 8 && /[A-Za-z0-9]/.test(tracking);
}

function collectTrackingCandidates(root) {
  const candidates = [];
  const seen = new Set();

  const push = (obj = {}) => {
    if (!isPlainObject(obj) || seen.has(obj)) return;
    seen.add(obj);
    const trackingNumber = firstValue(
      obj.tracking_number,
      obj.trackingNumber,
      objectTrackingValue(obj.tracking),
      obj.tracking_code,
      obj.trackingCode,
      obj.tracking_id,
      obj.trackingId,
      obj.number,
      obj.code,
    );
    const carrier = firstValue(
      obj.carrier,
      objectCarrierValue(obj.tracking),
      obj.carrier_name,
      obj.carrierName,
      obj.tracking_company,
      obj.shipping_carrier,
      obj.shippingCarrier,
      obj.shipping_provider,
      obj.shippingProvider,
    );
    const status = firstValue(obj.status, obj.shipment_status, obj.fulfillment_status, obj.production_status);
    const trackingUrl = firstValue(
      obj.tracking_url,
      obj.trackingUrl,
      obj.url,
      isPlainObject(obj.tracking) ? obj.tracking.url : '',
    );
    const updatedAt = firstValue(obj.updated_at, obj.updatedAt, obj.shipped_at, obj.shippedAt, obj.created_at, obj.createdAt);
    const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0;

    if (trackingNumber || carrier || status || trackingUrl) {
      candidates.push({
        trackingNumber,
        carrier,
        status,
        trackingUrl,
        updatedAt,
        updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
      });
    }
  };

  const pushDeep = (obj) => {
    if (!isPlainObject(obj)) return;
    push(obj);
    push(obj.data);
    push(obj.tracking);
    push(obj.order);
    push(obj.shipment);
    push(obj.shipping);
    [
      'trackings',
      'tracking_list',
      'shipments',
      'shipment_events',
      'events',
      'fulfillments',
      'items',
      'line_items',
    ].forEach((key) => {
      if (Array.isArray(obj[key])) obj[key].forEach(pushDeep);
    });
  };

  pushDeep(root);
  pushDeep(root?.data);
  return candidates;
}

function pickBestTracking(payload) {
  const picked = collectTrackingCandidates(payload)
    .filter((candidate) => (
      isValidTrackingNumber(candidate.trackingNumber)
      || candidate.carrier
      || candidate.status
      || candidate.trackingUrl
    ))
    .sort((a, b) => {
      const aHasTracking = isValidTrackingNumber(a.trackingNumber) ? 1 : 0;
      const bHasTracking = isValidTrackingNumber(b.trackingNumber) ? 1 : 0;
      if (aHasTracking !== bHasTracking) return bHasTracking - aHasTracking;
      return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
    })[0] || {};

  return {
    trackingNumber: isValidTrackingNumber(picked.trackingNumber) ? picked.trackingNumber : '',
    carrier: picked.carrier || '',
    status: lower(picked.status),
    trackingUrl: picked.trackingUrl || '',
    updatedAt: picked.updatedAt || null,
  };
}

function normalizeVendorTrackingPayload(provider, payload = {}) {
  const root = getPayloadRoot(payload);
  const picked = pickBestTracking(payload);
  const vendorStatus = picked.status || lower(
    root.status || payload.status || root.shipment_status || root.fulfillment_status,
  );
  return {
    provider: normalizeProviderKey(provider),
    vendorSubmissionId: firstValue(root.vendorSubmissionId, payload.vendorSubmissionId, root.vendor_submission_id, payload.vendor_submission_id),
    orderItemId: firstValue(root.orderItemId, payload.orderItemId, root.order_item_id, payload.order_item_id),
    vendorExternalOrderId: firstValue(
      root.vendorExternalOrderId,
      payload.vendorExternalOrderId,
      root.vendor_external_order_id,
      payload.vendor_external_order_id,
      root.externalOrderId,
      payload.externalOrderId,
      root.external_order_id,
      payload.external_order_id,
      root.external_number,
      payload.external_number,
      root.order_id,
      payload.order_id,
    ),
    trackingNumber: picked.trackingNumber,
    carrier: picked.carrier,
    trackingUrl: picked.trackingUrl,
    vendorStatus,
    delivered: ['delivered'].includes(vendorStatus),
    shipped: ['shipped', 'fulfilled', 'completed', 'complete', 'delivered'].includes(vendorStatus) || Boolean(picked.trackingNumber),
  };
}

module.exports = {
  cleanString,
  collectTrackingCandidates,
  isValidTrackingNumber,
  normalizeProviderKey,
  normalizeVendorTrackingPayload,
};
