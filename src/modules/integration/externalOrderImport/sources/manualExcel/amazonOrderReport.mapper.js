const { parseMoneyToMinorUnit } = require('../../helpers/money');

const aliases = {
  'order-id': ['amazon-order-id'],
  'order-item-id': ['order-item-id '],
  'quantity-purchased': ['quantity'],
};

function value(row, key) {
  const aliasKeys = [key, ...(aliases[key] || [])];
  const sourceKey = aliasKeys.find((candidate) => row[candidate] !== undefined)
    || Object.keys(row).find((candidate) => candidate.trim() === key);
  const result = sourceKey === undefined ? undefined : row[sourceKey];
  return result === undefined || result === null ? '' : String(result).trim();
}

function nullable(valueToNormalize) {
  return valueToNormalize === '' ? null : valueToNormalize;
}

function parseQuantity(row) {
  const raw = value(row, 'quantity-purchased') || value(row, 'number-of-items') || '1';
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function hasCustomization(row) {
  return Boolean(
    value(row, 'customized-url')
    || value(row, 'customized-page')
    || value(row, 'item-extensions-data'),
  );
}

function buildCustomizationRawSummary(row) {
  return {
    hasCustomization: hasCustomization(row),
    customizedUrl: nullable(value(row, 'customized-url')),
    customizedPage: nullable(value(row, 'customized-page')),
    itemExtensionsData: nullable(value(row, 'item-extensions-data')),
  };
}

function buildItem(row) {
  const currency = value(row, 'currency') || 'USD';

  return {
    externalItemId: value(row, 'order-item-id'),
    asin: nullable(value(row, 'asin')),
    sku: nullable(value(row, 'sku')),
    title: nullable(value(row, 'product-name')),
    quantity: parseQuantity(row),
    price: {
      currency,
      itemPriceAmount: parseMoneyToMinorUnit(value(row, 'item-price'), currency),
      itemTaxAmount: parseMoneyToMinorUnit(value(row, 'item-tax'), currency),
      shippingPriceAmount: parseMoneyToMinorUnit(value(row, 'shipping-price'), currency),
      shippingTaxAmount: parseMoneyToMinorUnit(value(row, 'shipping-tax'), currency),
      giftWrapPriceAmount: parseMoneyToMinorUnit(value(row, 'gift-wrap-price'), currency),
      giftWrapTaxAmount: parseMoneyToMinorUnit(value(row, 'gift-wrap-tax'), currency),
      itemPromotionDiscountAmount: parseMoneyToMinorUnit(value(row, 'item-promotion-discount'), currency),
      shipPromotionDiscountAmount: parseMoneyToMinorUnit(value(row, 'ship-promotion-discount'), currency),
    },
    customizationRawSummary: buildCustomizationRawSummary(row),
    externalData: {
      amazon: {
        itemPromotionId: nullable(value(row, 'item-promotion-id')),
        shipPromotionId: nullable(value(row, 'ship-promotion-id')),
        numberOfItems: nullable(value(row, 'number-of-items')),
        giftMessageText: nullable(value(row, 'gift-message-text')),
        giftWrapType: nullable(value(row, 'gift-wrap-type')),
      },
    },
  };
}

function mergeRowsPreferFirstNonEmpty(rows) {
  const keys = [];
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    });
  });

  return keys.reduce((merged, key) => {
    const rowWithValue = rows.find((row) => value(row, key) !== '');
    merged[key] = rowWithValue ? rowWithValue[key] : rows[0][key];
    return merged;
  }, {});
}

function buildItems(rows) {
  const groupedByItemId = new Map();

  rows.forEach((row) => {
    const externalItemId = value(row, 'order-item-id');
    if (!groupedByItemId.has(externalItemId)) {
      groupedByItemId.set(externalItemId, []);
    }
    groupedByItemId.get(externalItemId).push(row);
  });

  return [...groupedByItemId.values()].map((itemRows) => buildItem(mergeRowsPreferFirstNonEmpty(itemRows)));
}

function buildOrder(row, context, items) {
  return {
    source: 'MANUAL_EXCEL',
    importSources: ['MANUAL_EXCEL'],
    salesChannelCode: 'AMAZON',
    marketplaceCode: context.marketplaceCode,
    shopId: context.shopId,
    shopConnectionId: context.shopConnectionId,
    externalOrderId: value(row, 'order-id'),
    orderedAt: nullable(value(row, 'purchase-date')),
    shipByDate: nullable(value(row, 'latest-ship-date')),
    buyer: {
      name: nullable(value(row, 'buyer-name')),
      emailMasked: nullable(value(row, 'buyer-email')),
      phoneMasked: nullable(value(row, 'buyer-phone-number')),
    },
    shippingAddress: {
      name: nullable(value(row, 'recipient-name')),
      company: nullable(value(row, 'buyer-company-name')),
      addressLine1: nullable(value(row, 'ship-address-1')),
      addressLine2: nullable(value(row, 'ship-address-2')),
      addressLine3: nullable(value(row, 'ship-address-3')),
      addressType: nullable(value(row, 'address-type')),
      city: nullable(value(row, 'ship-city')),
      stateOrProvince: nullable(value(row, 'ship-state')),
      postalCode: nullable(value(row, 'ship-postal-code')),
      countryCode: nullable(value(row, 'ship-country')),
      phoneMasked: nullable(value(row, 'ship-phone-number')),
    },
    shippingService: {
      level: nullable(value(row, 'ship-service-level')),
      name: nullable(value(row, 'ship-service-name')),
    },
    externalData: {
      amazon: {
        paymentsDate: nullable(value(row, 'payments-date')),
        orderChannel: nullable(value(row, 'order-channel')),
        orderChannelInstance: nullable(value(row, 'order-channel-instance')),
        isBusinessOrder: nullable(value(row, 'is-business-order')),
        isPrime: nullable(value(row, 'is-prime')),
        isReplacementOrder: nullable(value(row, 'is-replacement-order')),
        isExchangeOrder: nullable(value(row, 'is-exchange-order')),
        originalOrderId: nullable(value(row, 'original-order-id')),
        isBuyerRequestedCancellation: nullable(value(row, 'is-buyer-requested-cancellation')),
        buyerRequestedCancelReason: nullable(value(row, 'buyer-requested-cancel-reason')),
        taxCollectionModel: nullable(value(row, 'tax-collection-model')),
        taxCollectionResponsibleParty: nullable(value(row, 'tax-collection-responsible-party')),
        fulfilledBy: nullable(value(row, 'fulfilled-by')),
      },
    },
    items,
  };
}

function mapAmazonOrderReportRowsToExternalOrderDtos(rows = [], context = {}) {
  const grouped = new Map();

  rows.forEach((row) => {
    const externalOrderId = value(row, 'order-id');
    if (!grouped.has(externalOrderId)) {
      grouped.set(externalOrderId, []);
    }
    grouped.get(externalOrderId).push(row);
  });

  return [...grouped.values()].map((groupRows) => (
    buildOrder(groupRows[0], context, buildItems(groupRows))
  ));
}

module.exports = {
  mergeRowsPreferFirstNonEmpty,
  mapAmazonOrderReportRowsToExternalOrderDtos,
};
