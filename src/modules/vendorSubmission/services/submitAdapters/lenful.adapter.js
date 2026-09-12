const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

const PROVIDER = 'LENFUL';

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function splitName(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
  };
}

function outputUrlForSlot(fileChecks = [], slotKey = 'FRONT') {
  const check = fileChecks.find((entry) => String(entry.slotKey || '').toUpperCase() === slotKey)
    || fileChecks.find((entry) => entry.outputVendorUrl || entry.outputUrl);
  return firstValue(check?.outputVendorUrl, check?.outputUrl) || '';
}

function buildPayload(submission = {}, { idempotencyKey } = {}) {
  const snapshot = submission.payloadSnapshot || {};
  const address = snapshot.orderSnapshot?.shippingAddress || snapshot.order?.shippingAddress || {};
  const item = snapshot.orderItemSnapshot || snapshot.orderItem || {};
  const listing = snapshot.listingSnapshot || snapshot.listing || {};
  const costCenter = snapshot.vendorCostCenter || {};
  const printMethod = firstValue(costCenter.printMethod, listing.printMethod);
  const name = splitName(firstValue(address.name, address.fullName, address.recipientName));
  const orderNumber = String(firstValue(idempotencyKey, item.externalOrderId, snapshot.externalOrderId, submission.orderItemId, submission.id) || '');
  const designUrl = outputUrlForSlot(snapshot.fileChecks || [], 'FRONT');

  return {
    order_number: orderNumber,
    first_name: name.firstName,
    last_name: name.lastName,
    email: firstValue(address.email, snapshot.orderSnapshot?.buyer?.emailMasked) || '',
    phone: firstValue(address.phone, address.phoneMasked, address.phoneNumber) || '',
    country_code: firstValue(address.countryCode, address.country) || '',
    province: firstValue(address.stateOrProvince, address.state, address.province, address.stateOrProvinceCode) || '',
    city: firstValue(address.city, address.cityName) || '',
    zip: firstValue(address.postalCode, address.zipCode, address.zip) || '',
    address_1: firstValue(address.addressLine1, address.address1, address.address) || '',
    address_2: firstValue(address.addressLine2, address.address2) || '',
    note: '',
    platform_label: '',
    items: [{
      design_sku: firstValue(snapshot.designSku, orderNumber),
      product_sku: firstValue(costCenter.sku, costCenter.lngCode, costCenter.code) || '',
      print_method: printMethod || '',
      quantity: Number(snapshot.fulfillQty || item.quantity || 1),
      mockups: [firstValue(item.productImageUrl, listing.previewVendorUrl, listing.thumbnailUrl)].filter(Boolean),
      designs: designUrl ? [{ position: 1, link: designUrl }] : [],
      request_clone: false,
      shippings: [Number(snapshot.shippingMethod ?? 0)],
    }],
  };
}

function validatePayload(payload = {}) {
  const missing = [];
  for (const field of ['order_number', 'first_name', 'last_name', 'country_code', 'province', 'city', 'zip', 'address_1']) {
    if (!payload[field]) missing.push(field);
  }
  if (!payload.items?.length) missing.push('items');
  (payload.items || []).forEach((item, index) => {
    if (!item.product_sku) missing.push(`items[${index}].product_sku`);
    if (!item.quantity) missing.push(`items[${index}].quantity`);
    if (!item.designs?.length) missing.push(`items[${index}].designs`);
  });
  if (missing.length) {
    throw appError(`Lenful payload is missing required fields: ${missing.join(', ')}`, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, { missing });
  }
}

function externalIdFrom(body = {}) {
  return firstValue(body.data?._id, body.data?.id, body._id, body.id, body.order_id, body.order_number);
}

async function submitPayload(payload, { credential } = {}) {
  validatePayload(payload);
  const base = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const token = credential?.accessToken;
  const storeId = credential?.metadata?.storeId;
  if (!base || !token || !storeId) {
    throw appError('Lenful credentials are not configured', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }
  const response = await fetch(`${base}/order/${storeId}/create?isCheckOrderNumber=true&autoPayment=false`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
  if (!response.ok || body.success === false) {
    throw appError('Lenful rejected order', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, {
      statusCode: response.status,
      message: body.message || null,
      response: body,
    });
  }
  return { provider: PROVIDER, externalId: externalIdFrom(body), response: body };
}

module.exports = {
  buildPayload,
  provider: PROVIDER,
  submitPayload,
  validatePayload,
};
