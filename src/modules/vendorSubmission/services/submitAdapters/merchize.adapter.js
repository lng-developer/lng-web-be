const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

const PROVIDER = 'MERCHIZE';

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function publicBaseUrl() {
  return String(process.env.API_PUBLIC_BASE_URL || process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
}

function assetDownloadUrl(assetId) {
  if (!assetId) return null;
  const path = `/api/media/assets/${assetId}/download`;
  const base = publicBaseUrl();
  return base ? `${base}${path}` : path;
}

function outputUrlForSlot(fileChecks = [], slotKey = 'FRONT') {
  const check = fileChecks.find((entry) => String(entry.slotKey || '').toUpperCase() === slotKey)
    || fileChecks.find((entry) => entry.outputAssetDownloadUrl || entry.outputAssetId || entry.outputAsset?.secureUrl);
  return firstValue(
    check?.outputAssetDownloadUrl,
    check?.outputAsset?.secureUrl,
    check?.outputUrl,
    assetDownloadUrl(check?.outputAssetId),
  ) || null;
}

function shippingInfo(snapshot = {}) {
  const address = snapshot.orderSnapshot?.shippingAddress || snapshot.order?.shippingAddress || {};
  return {
    full_name: firstValue(address.name, address.fullName, address.recipientName) || '',
    address_1: firstValue(address.addressLine1, address.address1, address.address) || '',
    address_2: firstValue(address.addressLine2, address.address2) || '',
    city: firstValue(address.city, address.cityName) || '',
    state: firstValue(address.stateOrProvinceCode, address.state, address.province) || '',
    postcode: firstValue(address.postalCode, address.zipCode, address.zip) || '',
    country: firstValue(address.countryCode, address.country) || '',
    email: firstValue(address.email, snapshot.orderSnapshot?.buyer?.emailMasked) || '',
    phone: firstValue(address.phone, address.phoneNumber) || '',
  };
}

function itemImage(snapshot = {}) {
  return firstValue(
    snapshot.orderItemSnapshot?.productImageUrl,
    snapshot.listingSnapshot?.previewAsset?.secureUrl,
    snapshot.listingSnapshot?.previewAssetDownloadUrl,
    snapshot.listingSnapshot?.thumbnailUrl,
  ) || null;
}

function buildPayload(submission = {}, { idempotencyKey } = {}) {
  const snapshot = submission.payloadSnapshot || {};
  const item = snapshot.orderItemSnapshot || snapshot.orderItem || {};
  const costCenter = snapshot.vendorCostCenter || {};
  const merchizeSku = firstValue(costCenter.sku, costCenter.lngCode, costCenter.code);
  const title = firstValue(item.title, snapshot.listingSnapshot?.title, snapshot.vendorProduct?.name, 'Custom Product');

  return {
    order_id: String(firstValue(idempotencyKey, item.externalOrderId, snapshot.externalOrderId, submission.orderItemId, submission.id) || ''),
    identifier: firstValue(snapshot.identifier, process.env.MERCHIZE_IDENTIFIER, 'lng-web-be'),
    shipping_info: shippingInfo(snapshot),
    tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
    items: [{
      name: title,
      product_id: merchizeSku || null,
      sku: merchizeSku || null,
      merchize_sku: merchizeSku || null,
      quantity: Number(snapshot.fulfillQty || item.quantity || 1),
      price: item.price?.itemPriceAmount ? Number(item.price.itemPriceAmount) / 100 : null,
      currency: item.price?.currency || 'USD',
      image: itemImage(snapshot),
      design_front: outputUrlForSlot(snapshot.fileChecks || [], 'FRONT'),
      attributes: [
        { name: 'product', option: title },
        ...(firstValue(costCenter.standardColor, costCenter.vendorColor)
          ? [{ name: 'Color', option: String(firstValue(costCenter.standardColor, costCenter.vendorColor)) }]
          : []),
        ...(firstValue(costCenter.standardSize, costCenter.vendorSize)
          ? [{ name: 'Size', option: String(firstValue(costCenter.standardSize, costCenter.vendorSize)) }]
          : []),
      ],
    }],
  };
}

function validatePayload(payload = {}) {
  const missing = [];
  if (!payload.order_id) missing.push('order_id');
  for (const field of ['full_name', 'address_1', 'city', 'state', 'postcode', 'country']) {
    if (!payload.shipping_info?.[field]) missing.push(`shipping_info.${field}`);
  }
  if (!payload.items?.length) missing.push('items');
  (payload.items || []).forEach((item, index) => {
    if (!item.merchize_sku && !item.product_id && !item.sku) missing.push(`items[${index}].merchize_sku`);
    if (!item.image) missing.push(`items[${index}].image`);
    if (!item.design_front && !item.design_back && !item.design_sleeve && !item.design_hood) {
      missing.push(`items[${index}].design_front`);
    }
    if (!item.attributes?.length) missing.push(`items[${index}].attributes`);
  });
  if (missing.length) {
    throw appError(`Merchize payload is missing required fields: ${missing.join(', ')}`, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, { missing });
  }
}

function externalIdFrom(body = {}) {
  return firstValue(body.data?._id, body._id, body.id, body.order_id, body.data?.order_id, body.data?.data?.order_id);
}

async function submitPayload(payload, { credential } = {}) {
  validatePayload(payload);
  const token = credential?.accessToken;
  const base = String(credential?.baseUrl || '').replace(/\/+$/, '');
  if (!token || !base) {
    throw appError('Merchize credentials are not configured', httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
  }
  const response = await fetch(`${base}/order/external/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
  if (!response.ok || body.success === false) {
    throw appError('Merchize rejected order', httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, {
      statusCode: response.status,
      message: body.message || null,
      response: body,
    });
  }
  return {
    provider: PROVIDER,
    externalId: externalIdFrom(body),
    response: body,
  };
}

module.exports = {
  buildPayload,
  provider: PROVIDER,
  submitPayload,
  validatePayload,
};
