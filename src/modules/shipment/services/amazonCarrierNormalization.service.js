function sanitizeTrackingNumber(trackingNumber) {
  if (trackingNumber === null || trackingNumber === undefined) return '';
  return String(trackingNumber).trim().replace(/[\r\n\t]+/g, '');
}

function formatAmazonShipDate(dateInput, now = new Date()) {
  const nowDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowIsoDate = nowDate.toISOString().split('T')[0];
  if (!dateInput) return nowIsoDate;

  const shipDate = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(shipDate.getTime())) return nowIsoDate;

  return shipDate.toISOString().split('T')[0] > nowIsoDate
    ? nowIsoDate
    : shipDate.toISOString().split('T')[0];
}

function mapCarrierToAmazon(carrier) {
  const rawCarrier = String(carrier || '').trim();
  const normalizedCarrier = rawCarrier.toUpperCase();

  if (normalizedCarrier.includes('USPS')) {
    return { carrier: 'USPS', carrierCode: 'USPS', carrierName: 'USPS', shipMethod: 'USPS First Class' };
  }
  if (normalizedCarrier.includes('UPS')) {
    return { carrier: 'UPS', carrierCode: 'UPS', carrierName: 'UPS', shipMethod: 'UPS Ground' };
  }
  if (normalizedCarrier.includes('FEDEX')) {
    return { carrier: 'FedEx', carrierCode: 'FedEx', carrierName: 'FedEx', shipMethod: 'FedEx Ground' };
  }
  if (normalizedCarrier.includes('YUN')) {
    return { carrier: 'YunExpress', carrierCode: 'YunExpress', carrierName: 'YunExpress', shipMethod: 'Standard' };
  }
  if (normalizedCarrier.includes('VIETTEL')) {
    return { carrier: 'VIETTEL_POST', carrierCode: 'Other', carrierName: 'Viettel Post', shipMethod: 'Standard' };
  }

  return { carrier: rawCarrier || 'Other', carrierCode: 'Other', carrierName: rawCarrier || 'Other', shipMethod: 'Standard' };
}

function normalizeForAmazon(input = {}, options = {}) {
  const trackingNumber = sanitizeTrackingNumber(input.trackingNumber);
  const isLngGroup = String(input.provider || '').trim().toUpperCase() === 'LNG_GROUP';
  const mapped = isLngGroup && trackingNumber
    ? { carrier: 'USPS', carrierCode: 'USPS', carrierName: 'USPS', shipMethod: 'USPS First Class' }
    : mapCarrierToAmazon(input.carrier);

  return {
    trackingNumber,
    ...mapped,
    shipDate: formatAmazonShipDate(input.shippedAt, options.now),
  };
}

module.exports = {
  formatAmazonShipDate,
  mapCarrierToAmazon,
  normalizeForAmazon,
  sanitizeTrackingNumber,
};
