const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

const PROVIDER = 'MERCHFOX';

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function splitName(name = '') {
  const [firstName = '', ...rest] = String(name).trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

function buildMerchfoxProduct(snapshot = {}) {
  const item = snapshot.orderItemSnapshot || snapshot.orderItem || {};
  const costCenter = snapshot.vendorCostCenter || {};
  const designUrlsByArea = Object.fromEntries((snapshot.fileChecks || [])
    .filter((check) => check?.slotKey && firstValue(check.outputVendorUrl, check.outputUrl))
    .map((check) => [String(check.slotKey).toUpperCase(), firstValue(check.outputVendorUrl, check.outputUrl)]));

  return {
    sku: firstValue(costCenter.sku, costCenter.lngCode, costCenter.code) || '',
    quantity: Number(snapshot.fulfillQty || item.quantity || 1),
    designUrlsByArea,
  };
}

function buildPayload(submission = {}, { idempotencyKey } = {}) {
  const snapshot = submission.payloadSnapshot || {};
  const address = snapshot.orderSnapshot?.shippingAddress || snapshot.order?.shippingAddress || {};
  const item = snapshot.orderItemSnapshot || snapshot.orderItem || {};
  const { firstName, lastName } = splitName(firstValue(address.name, address.fullName, address.recipientName));
  const products = Array.isArray(snapshot.bundledItems) && snapshot.bundledItems.length > 0
    ? snapshot.bundledItems.map(buildMerchfoxProduct)
    : [buildMerchfoxProduct(snapshot)];
  const hasBackPrint = products.some((p) => p.designUrlsByArea?.BACK);

  return {
    orderid: String(firstValue(idempotencyKey, item.externalOrderId, snapshot.externalOrderId, submission.id) || ''),
    firstName,
    lastName,
    address1: firstValue(address.addressLine1, address.address1, address.address) || '',
    address2: firstValue(address.addressLine2, address.address2) || '',
    city: firstValue(address.city, address.cityName) || '',
    state: firstValue(address.stateOrProvinceCode, address.state, address.province) || '',
    country: String(firstValue(address.countryCode, address.country) || '').toUpperCase(),
    zip: firstValue(address.postalCode, address.zipCode, address.zip) || '',
    email: firstValue(address.email, snapshot.orderSnapshot?.buyer?.emailMasked) || '',
    phone: firstValue(address.phone, address.phoneNumber, address.phoneMasked) || '',
    fulfillmentServiceKey: 'FIRST_CLASS',
    printAreaCount: hasBackPrint ? 2 : 1,
    products,
  };
}

function validatePayload(payload = {}) {
  const missing = ['orderid', 'firstName', 'address1', 'city', 'country', 'zip']
    .filter((field) => !payload[field]);
  if (!payload.products?.length) missing.push('products');
  (payload.products || []).forEach((product, index) => {
    if (!product?.sku) missing.push(`products[${index}].sku`);
    if (!product?.quantity) missing.push(`products[${index}].quantity`);
    if (!Object.keys(product?.designUrlsByArea || {}).length) missing.push(`products[${index}].designUrlsByArea`);
  });
  if (missing.length) {
    throw new AppError(`Merchfox payload is missing required fields: ${missing.join(', ')}`,
      httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, { missing });
  }
}

async function submitPayload(payload, { credential } = {}) {
  validatePayload(payload);
  const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const apiKey = credential?.apiKey;
  const apiSecret = credential?.apiSecret;
  if (!baseUrl || !apiKey || !apiSecret) {
    throw new AppError('Merchfox credentials are not configured', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  const response = await fetch(`${baseUrl}/api/v1/orders/quick/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mfx-App-Key': apiKey,
      'X-Mfx-App-Secret': apiSecret,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
  if (!response.ok || body.code !== 0) {
    throw new AppError('Merchfox rejected order', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, {
      statusCode: response.status,
      message: body.message || null,
      response: body,
    });
  }
  return { provider: PROVIDER, externalId: body.data?.id || null, response: body };
}

module.exports = { buildPayload, provider: PROVIDER, submitPayload, validatePayload };
