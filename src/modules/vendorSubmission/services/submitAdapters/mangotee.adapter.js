const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

const PROVIDER = 'MANGOTEE';

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function outputFiles(fileChecks = []) {
  return fileChecks
    .filter((check) => check.outputVendorUrl || check.outputUrl)
    .map((check) => ({
      key: String(check.slotKey || 'front').toLowerCase(),
      url: firstValue(check.outputVendorUrl, check.outputUrl),
    }));
}

function splitName(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || null };
}

function buildPayload(submission = {}, { idempotencyKey } = {}) {
  const snapshot = submission.payloadSnapshot || {};
  const item = snapshot.orderItemSnapshot || snapshot.orderItem || {};
  const address = snapshot.orderSnapshot?.shippingAddress || snapshot.order?.shippingAddress || {};
  const costCenter = snapshot.vendorCostCenter || {};
  const name = splitName(firstValue(address.name, address.fullName, address.recipientName));
  const sku = firstValue(costCenter.sku, costCenter.lngCode, costCenter.code);

  return {
    order_id: String(firstValue(item.externalOrderId, snapshot.externalOrderId, submission.orderItemId, submission.id) || ''),
    facility: firstValue(snapshot.facility, snapshot.facilityCode, costCenter.facility) || null,
    items: [{
      sku: sku || '',
      quantity: Number(snapshot.fulfillQty || item.quantity || 1),
      production_config: firstValue(costCenter.productionConfig, snapshot.productionConfig) || null,
      print_files: outputFiles(snapshot.fileChecks || []),
      preview_files: [],
    }],
    first_name: name.first_name,
    last_name: name.last_name,
    email: firstValue(address.email, snapshot.orderSnapshot?.buyer?.emailMasked) || '',
    phone: firstValue(address.phone, address.phoneNumber) || null,
    address_line_1: firstValue(address.addressLine1, address.address1, address.address) || '',
    address_line_2: firstValue(address.addressLine2, address.address2) || null,
    city: firstValue(address.city, address.cityName) || '',
    state: firstValue(address.stateOrProvince, address.state, address.province) || '',
    country: firstValue(address.countryCode, address.country) || '',
    zip: firstValue(address.postalCode, address.zipCode, address.zip) || '',
    shipping_method: firstValue(snapshot.shippingMethod, snapshot.shippingServiceCode, 'standard'),
    note: snapshot.note || null,
    seller: snapshot.storeCode || null,
    preferred_carrier: firstValue(snapshot.preferredCarrier, 'auto'),
    tracking_number: null,
  };
}

function validatePayload(payload = {}) {
  const missing = [];
  for (const field of ['order_id', 'first_name', 'address_line_1', 'city', 'state', 'country', 'zip', 'shipping_method']) {
    if (!payload[field]) missing.push(field);
  }
  if (!payload.items?.length) missing.push('items');
  (payload.items || []).forEach((item, index) => {
    if (!item.sku) missing.push(`items[${index}].sku`);
    if (!item.quantity) missing.push(`items[${index}].quantity`);
    if (!item.print_files?.length) missing.push(`items[${index}].print_files`);
  });
  if (missing.length) {
    throw appError(`MangoTee payload is missing required fields: ${missing.join(', ')}`, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, { missing });
  }
}

function externalIdFrom(body = {}, fallback) {
  return firstValue(body.data?.order_id, body.data?.id, body.order_id, body.id, fallback);
}

async function submitPayload(payload, { credential } = {}) {
  validatePayload(payload);
  const base = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const apiKey = credential?.accessToken;
  if (!base || !apiKey) {
    throw appError('MangoTee credentials are not configured', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }
  const response = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
  if (!response.ok || body.status === false) {
    throw appError('MangoTee rejected order', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, {
      statusCode: response.status,
      message: body.message || null,
      response: body,
    });
  }
  return { provider: PROVIDER, externalId: externalIdFrom(body, payload.order_id), response: body };
}

module.exports = { buildPayload, provider: PROVIDER, submitPayload, validatePayload };
