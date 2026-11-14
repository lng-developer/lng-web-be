const config = require('../../../config');
const logger = require('../../../shared/utils/logger');

const AFTERSHIP_API_BASE = 'https://api.aftership.com/tracking/2024-10';

const SLUG_AMAZON_MAP = Object.freeze({
  usps: { carrierCode: 'USPS', carrierName: 'USPS', shipMethod: 'USPS Ground Advantage' },
  ups: { carrierCode: 'UPS', carrierName: 'UPS', shipMethod: 'UPS Ground' },
  'ups-freight': { carrierCode: 'UPS', carrierName: 'UPS', shipMethod: 'UPS Ground' },
  'ups-mail-innovations': { carrierCode: 'UPS', carrierName: 'UPS', shipMethod: 'UPS Mail Innovations' },
  fedex: { carrierCode: 'FedEx', carrierName: 'FedEx', shipMethod: 'FedEx Ground' },
  'fedex-smartpost': { carrierCode: 'FedEx', carrierName: 'FedEx', shipMethod: 'FedEx SmartPost' },
  dhl: { carrierCode: 'DHL Express', carrierName: 'DHL Express', shipMethod: 'Standard' },
  'dhl-express': { carrierCode: 'DHL Express', carrierName: 'DHL Express', shipMethod: 'Standard' },
  'dhl-global-mail': { carrierCode: 'DHL', carrierName: 'DHL Global Mail', shipMethod: 'Standard' },
  yunexpress: { carrierCode: 'YunExpress', carrierName: 'YunExpress', shipMethod: 'Standard' },
  '4px': { carrierCode: '4PX', carrierName: '4PX', shipMethod: 'Standard' },
  viettelpost: { carrierCode: 'Other', carrierName: 'Viettel Post', shipMethod: 'Standard' },
});

function sanitizeTrackingNumber(trackingNumber) {
  if (trackingNumber === null || trackingNumber === undefined) return '';
  return String(trackingNumber).trim().replace(/[\r\n\t]+/g, '');
}

function mapSlugToAmazonCarrier(slug, courierName) {
  const normalized = String(slug || '').trim().toLowerCase();
  if (SLUG_AMAZON_MAP[normalized]) {
    return { ...SLUG_AMAZON_MAP[normalized] };
  }

  const cleanName = String(courierName || slug || 'Other').trim();
  const upper = cleanName.toUpperCase();
  if (upper.includes('USPS')) return { carrierCode: 'USPS', carrierName: 'USPS', shipMethod: 'USPS Ground Advantage' };
  if (upper.includes('UPS')) return { carrierCode: 'UPS', carrierName: 'UPS', shipMethod: 'UPS Ground' };
  if (upper.includes('FEDEX')) return { carrierCode: 'FedEx', carrierName: 'FedEx', shipMethod: 'FedEx Ground' };
  if (upper.includes('YUN')) return { carrierCode: 'YunExpress', carrierName: 'YunExpress', shipMethod: 'Standard' };
  if (upper.includes('VIETTEL')) return { carrierCode: 'Other', carrierName: 'Viettel Post', shipMethod: 'Standard' };

  return {
    carrierCode: 'Other',
    carrierName: cleanName,
    shipMethod: 'Standard',
  };
}

function formatAmazonShipDate(dateInput, now = new Date()) {
  const nowDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowIsoDate = nowDate.toISOString().split('T')[0];

  if (!dateInput) return nowIsoDate;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return nowIsoDate;

  const targetIsoDate = d.toISOString().split('T')[0];
  // Amazon strictly rejects any ship-date in the future relative to UTC
  if (targetIsoDate > nowIsoDate) {
    return nowIsoDate;
  }
  return targetIsoDate;
}

async function detectCourier(trackingNumber, options = {}) {
  const cleanNumber = sanitizeTrackingNumber(trackingNumber);
  if (!cleanNumber) return null;

  const apiKey = options.apiKey || config.aftership?.apiKey;
  if (!apiKey) {
    logger.warn('aftership_detect_courier_skipped', { reason: 'API key not configured' });
    return null;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const url = `${AFTERSHIP_API_BASE}/couriers/detect`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 5000);

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'as-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tracking_number: cleanNumber }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      logger.warn('aftership_detect_failed', { status: response.status });
      return null;
    }

    const body = await response.json().catch(() => ({}));
    const couriers = body?.data?.couriers;
    if (!Array.isArray(couriers) || !couriers.length) {
      return null;
    }

    const primary = couriers[0];
    return {
      slug: primary.slug,
      name: primary.name,
      otherName: primary.other_name || null,
    };
  } catch (error) {
    logger.warn('aftership_detect_error', { message: error.message });
    return null;
  }
}

async function normalizeForAmazon(input = {}, options = {}) {
  const trackingNumber = sanitizeTrackingNumber(input.trackingNumber);
  const now = options.now || new Date();
  const rawCarrier = String(input.carrier || '').trim();
  const shipDate = formatAmazonShipDate(input.shippedAt, now);

  if (!trackingNumber) {
    const fallbackMapped = mapSlugToAmazonCarrier('', rawCarrier);
    return {
      trackingNumber: '',
      carrier: rawCarrier || fallbackMapped.carrierName,
      carrierCode: fallbackMapped.carrierCode,
      carrierName: fallbackMapped.carrierName,
      shipMethod: fallbackMapped.shipMethod,
      shipDate,
      detected: false,
    };
  }

  const detected = await detectCourier(trackingNumber, options);
  if (detected && detected.slug) {
    const mapped = mapSlugToAmazonCarrier(detected.slug, detected.name);
    return {
      trackingNumber,
      carrier: mapped.carrierName,
      carrierCode: mapped.carrierCode,
      carrierName: mapped.carrierName,
      shipMethod: mapped.shipMethod,
      shipDate,
      aftershipSlug: detected.slug,
      detected: true,
    };
  }

  // Fallback to raw carrier mapping when AfterShip cannot detect
  const fallbackMapped = mapSlugToAmazonCarrier('', rawCarrier);
  return {
    trackingNumber,
    carrier: rawCarrier || fallbackMapped.carrierName,
    carrierCode: fallbackMapped.carrierCode,
    carrierName: fallbackMapped.carrierName,
    shipMethod: fallbackMapped.shipMethod,
    shipDate,
    detected: false,
  };
}

module.exports = {
  detectCourier,
  formatAmazonShipDate,
  mapSlugToAmazonCarrier,
  normalizeForAmazon,
  sanitizeTrackingNumber,
};
