const { parseMoneyToMinorUnit } = require('../../helpers/money');

function value(row, key) {
  const result = row[key];
  return result === undefined || result === null ? '' : String(result).trim();
}

function nullable(valueToNormalize) {
  return valueToNormalize === '' ? null : valueToNormalize;
}

function parseQuantity(row) {
  const parsed = Number.parseInt(value(row, 'Quantity') || '1', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// Intl supplies English region names without another country-list dependency.
const countryCodesByName = new Map();
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
for (let a = 65; a <= 90; a += 1) {
  for (let b = 65; b <= 90; b += 1) {
    const code = String.fromCharCode(a, b);
    const name = regionNames.of(code);
    if (name) countryCodesByName.set(name.toUpperCase(), code);
  }
}

function normalizeCountryCode(rawCountry) {
  const country = String(rawCountry || '').trim();
  const upper = country.toUpperCase();
  const aliases = {
    'UNITED STATES': 'US',
    USA: 'US',
    'U.S.': 'US',
    'U.S.A.': 'US',
    'UNITED KINGDOM': 'GB',
    UK: 'GB',
    CANADA: 'CA',
    AUSTRALIA: 'AU',
  };

  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return aliases[upper] || countryCodesByName.get(upper) || null;
}

function optionalDate(row, key) {
  const input = value(row, key);
  if (!input) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(input) || !Number.isFinite(Date.parse(input))) throw new Error(`Invalid ${key}`);
  const calendarDate = input.slice(0, 10);
  if (new Date(calendarDate).toISOString().slice(0, 10) !== calendarDate) throw new Error(`Invalid ${key}`);
  return new Date(input).toISOString();
}

function optionalPaymentStatus(row) {
  const status = value(row, 'LNG Payment Status').toUpperCase();
  if (!status) return undefined;
  if (!['PAID', 'PENDING', 'REFUNDED', 'UNKNOWN'].includes(status)) throw new Error('Invalid LNG Payment Status');
  return status;
}

function orderFinancialSnapshot(row) {
  const fields = { orderDiscountAmount: 'LNG Order Discount', shippingDiscountAmount: 'LNG Shipping Discount', orderTotalAmount: 'LNG Order Total' };
  if (!Object.values(fields).some(key => value(row, key))) return undefined;
  return Object.fromEntries([
    ['currency', value(row, 'Currency') || 'USD'],
    ...Object.entries(fields).map(([key, header]) => {
      const amount = value(row, header);
      if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error(`Invalid ${header}`);
      return [key, amount ? parseMoneyToMinorUnit(amount) : null];
    }),
  ]);
}

const customizationVariationKeyPattern = /(^|[,;\n])\s*(custom|personalization|enter your custom|custom name|names|event date|initials|ink color|photo|choose your design|type printing option)\s*:/i;

function hasCustomization(row) {
  return Boolean(
    value(row, 'Personalization')
    || value(row, 'customization_url')
    || customizationVariationKeyPattern.test(value(row, 'Variations')),
  );
}

function buildCustomizationRawSummary(row) {
  const expectedFileCount = Number(value(row, 'LNG Expected Files') || 0);
  if (!Number.isInteger(expectedFileCount) || expectedFileCount < 0 || expectedFileCount > 20) throw new Error('Invalid expected file count');
  const needsReview = value(row, 'LNG Needs Review') === 'true';
  return {
    hasCustomization: hasCustomization(row) || expectedFileCount > 0 || needsReview,
    provider: 'ETSY',
    expectedFileCount,
    needsReview,
    variations: nullable(value(row, 'Variations')),
    personalization: nullable(value(row, 'Personalization')),
    customizedUrl: nullable(value(row, 'customization_url')),
  };
}

function buildItem(row) {
  const currency = value(row, 'Currency') || 'USD';
  const transactionId = value(row, 'Transaction ID');
  const listingId = value(row, 'Listing ID');

  return {
    externalItemId: transactionId,
    externalListingId: nullable(listingId),
    externalStatus: value(row, 'LNG Etsy Status') || undefined,
    shipByDate: optionalDate(row, 'LNG Ship By'),
    sku: nullable(value(row, 'SKU')),
    title: nullable(value(row, 'Item Name')),
    quantity: parseQuantity(row),
    variantRaw: nullable(value(row, 'Variations')),
    price: {
      currency,
      itemPriceAmount: parseMoneyToMinorUnit(value(row, 'Price') || value(row, 'Item Total'), currency),
      itemTaxAmount: parseMoneyToMinorUnit(value(row, 'Order Sales Tax'), currency),
      shippingPriceAmount: parseMoneyToMinorUnit(value(row, 'Order Shipping'), currency),
    },
    customizationRawSummary: buildCustomizationRawSummary(row),
    externalData: {
      etsy: {
        receiptId: value(row, 'Order ID'),
        transactionId,
        listingId: nullable(listingId),
        listingImageUrl: nullable(value(row, 'LNG Listing Image')),
        listingImageThumbnailUrl: nullable(value(row, 'LNG Listing Thumbnail')),
        orderType: nullable(value(row, 'Order Type')),
        listingsType: nullable(value(row, 'Listings Type')),
        paymentType: nullable(value(row, 'Payment Type')),
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
  const groupedByTransactionId = new Map();

  rows.forEach((row) => {
    const externalItemId = value(row, 'Transaction ID');
    if (!groupedByTransactionId.has(externalItemId)) {
      groupedByTransactionId.set(externalItemId, []);
    }
    groupedByTransactionId.get(externalItemId).push(row);
  });

  return [...groupedByTransactionId.values()].map((itemRows) => buildItem(mergeRowsPreferFirstNonEmpty(itemRows)));
}

function buildOrder(row, context, items) {
  return {
    source: 'MANUAL_EXCEL',
    importSources: ['MANUAL_EXCEL'],
    salesChannelCode: 'ETSY',
    marketplaceCode: context.marketplaceCode,
    shopId: context.shopId,
    shopConnectionId: context.shopConnectionId,
    externalAccountId: context.externalAccountId,
    externalOrderId: value(row, 'Order ID'),
    externalStatus: value(row, 'LNG Etsy Status') || undefined,
    paymentStatus: optionalPaymentStatus(row),
    shipByDate: optionalDate(row, 'LNG Ship By'),
    shippingService: value(row, 'LNG Shipping Service') ? { name: value(row, 'LNG Shipping Service') } : undefined,
    orderedAt: nullable(value(row, 'Date Paid') || value(row, 'Sale Date')),
    buyer: {
      name: nullable(value(row, 'Ship Name') || value(row, 'Buyer')),
    },
    shippingAddress: {
      name: nullable(value(row, 'Ship Name')),
      addressLine1: nullable(value(row, 'Ship Address1')),
      addressLine2: nullable(value(row, 'Ship Address2')),
      city: nullable(value(row, 'Ship City')),
      stateOrProvince: nullable(value(row, 'Ship State')),
      postalCode: nullable(value(row, 'Ship Zipcode')),
      countryCode: normalizeCountryCode(value(row, 'Ship Country')),
      country: nullable(value(row, 'Ship Country')),
    },
    externalData: {
      etsy: {
        receiptId: value(row, 'Order ID'),
        // Keep source order totals as evidence; item prices may already include discounts.
        financial: orderFinancialSnapshot(row),
      },
    },
    items,
  };
}

function mapEtsySoldOrderItemRowsToExternalOrderDtos(rows = [], context = {}) {
  const grouped = new Map();

  rows.forEach((row) => {
    const externalOrderId = value(row, 'Order ID');
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
  mapEtsySoldOrderItemRowsToExternalOrderDtos,
  mergeRowsPreferFirstNonEmpty,
  normalizeCountryCode,
};
