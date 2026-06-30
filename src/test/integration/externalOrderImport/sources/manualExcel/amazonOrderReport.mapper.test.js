const {
  mapAmazonOrderReportRowsToExternalOrderDtos,
} = require('../../../../../modules/integration/externalOrderImport/sources/manualExcel/amazonOrderReport.mapper');

describe('amazonOrderReport.mapper', () => {
  const context = {
    shopId: '660000000000000000000201',
    shopConnectionId: '660000000000000000000211',
    marketplaceCode: 'AMAZON_US',
    sourceFileId: '660000000000000000000701',
  };

  test('groups multiple order rows into one external order dto with mapped items', () => {
    const rows = [
      {
        'order-id': '113-1',
        'order-item-id': '000000000000000001',
        'purchase-date': '2026-06-01T00:00:00Z',
        'latest-ship-date': '2026-06-05T00:00:00Z',
        sku: 'SKU-1',
        asin: 'ASIN1',
        'product-name': 'Mug',
        'quantity-purchased': '1',
        currency: 'USD',
        'item-price': '35.30',
        'item-tax': '2.77',
        'shipping-price': '0.49',
        'ship-service-level': 'Standard',
        'ship-service-name': 'Std Shipping',
        'buyer-name': 'Buyer',
        'recipient-name': 'Recipient',
        'ship-city': 'Austin',
        'ship-country': 'US',
        'customized-url': 'https://example.test/custom.zip',
      },
      {
        'order-id': '113-1',
        'order-item-id': '000000000000000002',
        sku: 'SKU-2',
        'product-name': 'Shirt',
        'number-of-items': '2',
        'item-price': '10',
      },
    ];

    const [dto] = mapAmazonOrderReportRowsToExternalOrderDtos(rows, context);

    expect(dto).toMatchObject({
      source: 'MANUAL_EXCEL',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      shopId: context.shopId,
      shopConnectionId: context.shopConnectionId,
      externalOrderId: '113-1',
      orderedAt: '2026-06-01T00:00:00Z',
      shipByDate: '2026-06-05T00:00:00Z',
      buyer: { name: 'Buyer' },
      shippingAddress: { name: 'Recipient', city: 'Austin', countryCode: 'US' },
      shippingService: { level: 'Standard', name: 'Std Shipping' },
    });
    expect(dto.items).toHaveLength(2);
    expect(dto.items[0]).toMatchObject({
      externalItemId: '000000000000000001',
      sku: 'SKU-1',
      asin: 'ASIN1',
      title: 'Mug',
      quantity: 1,
      price: {
        currency: 'USD',
        itemPriceAmount: 3530,
        itemTaxAmount: 277,
        shippingPriceAmount: 49,
      },
      customizationRawSummary: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
      },
    });
    expect(dto.items[1]).toMatchObject({
      externalItemId: '000000000000000002',
      quantity: 2,
      customizationRawSummary: { hasCustomization: false },
    });
  });

  test('merges duplicate item rows without letting blank rows erase richer item data', () => {
    const rows = [
      {
        'order-id': '114-7103338-7543469',
        'order-item-id': '160772073777961',
        sku: 'J2502-TS1S-US-05022026-125',
        'product-name': 'Personalized Shirt',
        'quantity-purchased': '1',
        currency: 'USD',
        'item-price': '35.30',
        'item-tax': '2.77',
        'shipping-price': '5.95',
        'shipping-tax': '0.49',
        'customized-url': 'https://example.test/custom.zip',
        'customized-page': 'https://a.co/example',
      },
      {
        'order-id': '114-7103338-7543469',
        'order-item-id': '160772073777961',
        sku: '',
        'product-name': '',
        'quantity-purchased': '',
        currency: '',
        'item-price': '',
        'item-tax': '',
        'shipping-price': '',
        'shipping-tax': '',
        'customized-url': '',
        'customized-page': '',
      },
      {
        'order-id': '114-7103338-7543469',
        'order-item-id': '160772073777962',
        sku: 'SKU-2',
        'product-name': 'Second Item',
        'quantity-purchased': '1',
      },
    ];

    const [dto] = mapAmazonOrderReportRowsToExternalOrderDtos(rows, context);

    expect(dto.items).toHaveLength(2);
    expect(dto.items[0]).toMatchObject({
      externalItemId: '160772073777961',
      sku: 'J2502-TS1S-US-05022026-125',
      title: 'Personalized Shirt',
      price: {
        currency: 'USD',
        itemPriceAmount: 3530,
        itemTaxAmount: 277,
        shippingPriceAmount: 595,
        shippingTaxAmount: 49,
      },
      customizationRawSummary: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
        customizedPage: 'https://a.co/example',
      },
    });
    expect(dto.items[1]).toMatchObject({
      externalItemId: '160772073777962',
      sku: 'SKU-2',
    });
  });

  test('maps alternate Amazon report headers with amazon-order-id and trimmed order-item-id', () => {
    const [dto] = mapAmazonOrderReportRowsToExternalOrderDtos([
      {
        'amazon-order-id': '111-6364237-0744254',
        'order-item-id ': '163223994462241',
        quantity: '1',
        sku: 'J2520-TS2S-140326-2208',
        asin: 'B0TEST',
        'product-name': 'Personalized Pug Sweatshirt',
        currency: 'USD',
        'item-price': '25.50',
        'ship-city': 'Yonkers',
        'ship-state': 'NY',
        'ship-country': 'US',
        'customized-url': 'https://example.test/custom.zip',
      },
    ], context);

    expect(dto.externalOrderId).toBe('111-6364237-0744254');
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({
      externalItemId: '163223994462241',
      quantity: 1,
      sku: 'J2520-TS2S-140326-2208',
      title: 'Personalized Pug Sweatshirt',
      price: { itemPriceAmount: 2550 },
      customizationRawSummary: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
      },
    });
  });
});
