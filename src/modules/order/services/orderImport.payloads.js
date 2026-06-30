const { orderStatuses } = require('../constants/orderStatuses');
const {
  compactObject,
  getImportSources,
  getInitialItemStatus,
  getItemRawRecordIds,
  getOrderRawRecordIds,
  normalizeTrimmed,
} = require('./orderImport.helpers');

function buildOrderCreatePayload(dto, identity, now) {
  return compactObject({
    shopId: dto.shopId,
    shopConnectionId: dto.shopConnectionId,
    ...identity,
    externalAccountId: dto.externalAccountId,
    externalStatus: dto.externalStatus,
    importSources: getImportSources(dto),
    orderedAt: dto.orderedAt,
    shipByDate: dto.shipByDate,
    deliveredByDate: dto.deliveredByDate,
    buyer: dto.buyer,
    shippingAddress: dto.shippingAddress,
    shippingService: dto.shippingService,
    addressValidationStatus: dto.addressValidationStatus,
    status: orderStatuses.IMPORTED,
    rawRecordIds: getOrderRawRecordIds(dto),
    externalData: dto.externalData,
    importedAt: now,
    lastImportedAt: now,
  });
}

function buildOrderUpdatePayload(dto, now) {
  return {
    set: compactObject({
      shopConnectionId: dto.shopConnectionId,
      externalAccountId: dto.externalAccountId,
      externalStatus: dto.externalStatus,
      orderedAt: dto.orderedAt,
      shipByDate: dto.shipByDate,
      deliveredByDate: dto.deliveredByDate,
      buyer: dto.buyer,
      shippingAddress: dto.shippingAddress,
      shippingService: dto.shippingService,
      addressValidationStatus: dto.addressValidationStatus,
      externalData: dto.externalData,
      lastImportedAt: now,
    }),
    addToSet: {
      importSources: getImportSources(dto),
      rawRecordIds: getOrderRawRecordIds(dto),
    },
  };
}

function buildItemBasePayload(item, dto, identity, orderId, importSources, now) {
  return compactObject({
    orderId,
    shopId: dto.shopId,
    shopConnectionId: dto.shopConnectionId,
    ...identity,
    externalItemId: normalizeTrimmed(item.externalItemId),
    externalAccountId: dto.externalAccountId,
    externalProductId: item.externalProductId,
    externalListingId: item.externalListingId,
    externalVariantId: item.externalVariantId,
    asin: item.asin,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    variantRaw: item.variantRaw,
    customizationRawSummary: item.customizationRawSummary,
    price: item.price,
    listingId: item.listingId,
    externalStatus: item.externalStatus,
    shipByDate: item.shipByDate,
    rawRecordId: item.rawRecordId,
    rawRecordIds: getItemRawRecordIds(item),
    importSources,
    externalData: item.externalData,
    lastImportedAt: now,
  });
}

function buildItemCreatePayload(item, dto, identity, orderId, importSources, now) {
  return {
    ...buildItemBasePayload(item, dto, identity, orderId, importSources, now),
    status: getInitialItemStatus(item),
    importedAt: now,
  };
}

function buildItemUpdatePayload(item, dto, now, importSources) {
  return {
    set: compactObject({
      shopConnectionId: dto.shopConnectionId,
      externalAccountId: dto.externalAccountId,
      externalProductId: item.externalProductId,
      externalListingId: item.externalListingId,
      externalVariantId: item.externalVariantId,
      asin: item.asin,
      sku: item.sku,
      title: item.title,
      quantity: item.quantity,
      variantRaw: item.variantRaw,
      customizationRawSummary: item.customizationRawSummary,
      price: item.price,
      listingId: item.listingId,
      externalStatus: item.externalStatus,
      shipByDate: item.shipByDate,
      rawRecordId: item.rawRecordId,
      externalData: item.externalData,
      lastImportedAt: now,
    }),
    addToSet: {
      importSources,
      rawRecordIds: getItemRawRecordIds(item),
    },
  };
}

module.exports = {
  buildItemCreatePayload,
  buildItemUpdatePayload,
  buildOrderCreatePayload,
  buildOrderUpdatePayload,
};
