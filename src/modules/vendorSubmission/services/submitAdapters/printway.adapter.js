const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

const PROVIDER = 'PRINTWAY';

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
    || fileChecks.find((entry) => entry.outputAssetDownloadUrl || entry.outputUrl || entry.outputAsset?.secureUrl);
  return firstValue(check?.outputAssetDownloadUrl, check?.outputUrl, check?.outputAsset?.secureUrl) || '';
}

function buildPayload(submission = {}, { idempotencyKey } = {}) {
  const snapshot = submission.payloadSnapshot || {};
  const address = snapshot.orderSnapshot?.shippingAddress || snapshot.order?.shippingAddress || {};
  const item = snapshot.orderItemSnapshot || snapshot.orderItem || {};
  const costCenter = snapshot.vendorCostCenter || {};
  const title = firstValue(item.title, snapshot.vendorProduct?.name, 'Custom Product');
  const name = splitName(firstValue(address.name, address.fullName, address.recipientName));

  return {
    order_id: String(firstValue(idempotencyKey, item.externalOrderId, snapshot.externalOrderId, submission.orderItemId, submission.id) || ''),
    store_code: snapshot.storeCode || '',
    tiktok_order_type: 'seller',
    shipping_email: firstValue(address.email, snapshot.orderSnapshot?.buyer?.emailMasked) || '',
    firstName: name.firstName,
    lastName: name.lastName,
    shipping_phone: firstValue(address.phone, address.phoneMasked, address.phoneNumber) || '',
    shipping_address1: firstValue(address.addressLine1, address.address1, address.address) || '',
    shipping_address2: firstValue(address.addressLine2, address.address2) || '',
    shipping_city: firstValue(address.city, address.cityName) || '',
    shipping_province: firstValue(address.stateOrProvince, address.state, address.province) || '',
    shipping_province_code: firstValue(address.stateOrProvinceCode, address.stateCode, address.state) || '',
    shipping_zip: firstValue(address.postalCode, address.zipCode, address.zip) || '',
    shipping_country: firstValue(address.country) || '',
    shipping_country_code: firstValue(address.countryCode, address.country) || '',
    shipping_service: snapshot.shippingServiceCode || '',
    discount_code: [],
    taxNumber: '',
    order_items: [{
      product_location: snapshot.productLocation || '',
      made_in_location: snapshot.madeInLocation || '',
      product_name: title,
      item_sku: firstValue(costCenter.sku, costCenter.lngCode, costCenter.code) || '',
      variant_id: snapshot.variantId || '',
      quantity: Number(snapshot.fulfillQty || item.quantity || 1),
      variant_note: '',
      mockup_url: firstValue(item.productImageUrl, snapshot.listingSnapshot?.thumbnailUrl) || '',
      artwork_front: outputUrlForSlot(snapshot.fileChecks || [], 'FRONT'),
      artwork_back: outputUrlForSlot(snapshot.fileChecks || [], 'BACK'),
    }],
  };
}

function validatePayload(payload = {}) {
  const missing = [];
  for (const field of ['order_id', 'firstName', 'lastName', 'shipping_address1', 'shipping_city', 'shipping_province_code', 'shipping_zip', 'shipping_country_code']) {
    if (!payload[field]) missing.push(field);
  }
  if (!payload.order_items?.length) missing.push('order_items');
  (payload.order_items || []).forEach((item, index) => {
    if (!item.item_sku && !item.variant_id) missing.push(`order_items[${index}].item_sku`);
    if (!item.product_name) missing.push(`order_items[${index}].product_name`);
    if (!item.quantity) missing.push(`order_items[${index}].quantity`);
    if (!item.artwork_front && !item.artwork_back) missing.push(`order_items[${index}].artwork_front`);
  });
  if (missing.length) {
    throw appError(`Printway payload is missing required fields: ${missing.join(', ')}`, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, { missing });
  }
}

function externalIdFrom(body = {}) {
  return firstValue(body.data?.pw_order_id, body.result?.order_id, body.pw_order_id, body.order_id, body.data?.order_name);
}

async function submitPayload(payload, { credential } = {}) {
  validatePayload(payload);
  const base = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const token = credential?.accessToken;
  if (!base || !token) {
    throw appError('Printway credentials are not configured', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }
  const response = await fetch(`${base}/order/create-new-order`, {
    method: 'POST',
    headers: {
      'pw-access-token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
  if (!response.ok || body.success === false || Number(body.status) >= 400) {
    throw appError('Printway rejected order', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, {
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
