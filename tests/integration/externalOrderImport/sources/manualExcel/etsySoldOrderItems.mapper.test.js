const {
  mapEtsySoldOrderItemRowsToExternalOrderDtos,
} = require('../../../../../src/modules/integration/externalOrderImport/sources/manualExcel/etsySoldOrderItems.mapper');

describe('etsySoldOrderItems.mapper', () => {
  test.each([['Switzerland', 'CH'], ['Germany', 'DE'], ['Unknown destination', null]])('preserves country %s', (country, code) => {
    const [dto] = mapEtsySoldOrderItemRowsToExternalOrderDtos([{ 'Order ID': '1', 'Transaction ID': '2', 'Ship Country': country }]);
    expect(dto.shippingAddress).toMatchObject({ country, countryCode: code });
  });
  test('preserves source lifecycle and financial evidence without applying order discounts twice', () => {
    const [dto] = mapEtsySoldOrderItemRowsToExternalOrderDtos([{
      'Order ID': '1', 'Transaction ID': '2', Price: '20', Currency: 'USD',
      'LNG Etsy Status': 'Completed', 'LNG Payment Status': 'PAID',
      'LNG Ship By': '2026-10-20T00:00:00.000Z', 'LNG Shipping Service': 'Express',
      'LNG Order Discount': '5', 'LNG Shipping Discount': '2', 'LNG Order Total': '18',
    }]);
    expect(dto).toMatchObject({ externalStatus: 'Completed', paymentStatus: 'PAID', shipByDate: '2026-10-20T00:00:00.000Z', shippingService: { name: 'Express' } });
    expect(dto.items[0]).toMatchObject({ externalStatus: 'Completed', shipByDate: dto.shipByDate });
    expect(dto.externalData.etsy.financial).toMatchObject({ orderDiscountAmount: 500, shippingDiscountAmount: 200, orderTotalAmount: 1800, currency: 'USD' });
    expect(dto.items[0].price.itemPromotionDiscountAmount || 0).toBe(0);
  });
  test('old CSV does not clear previously known lifecycle fields or infer payment', () => {
    const [dto] = mapEtsySoldOrderItemRowsToExternalOrderDtos([{ 'Order ID': '1', 'Transaction ID': '2', 'Date Paid': '10/01/2026' }]);
    expect(dto.externalStatus).toBeUndefined();
    expect(dto.shipByDate).toBeUndefined();
    expect(dto.paymentStatus).toBeUndefined();
  });
  test.each([
    ['LNG Ship By', 'not a date'], ['LNG Ship By', '2026-02-31'],
    ['LNG Payment Status', 'guess'], ['LNG Order Discount', 'USD 5'],
  ])('rejects malformed source field %s=%s', (key, input) => {
    expect(() => mapEtsySoldOrderItemRowsToExternalOrderDtos([{ 'Order ID': '1', 'Transaction ID': '2', [key]: input }])).toThrow();
  });
  test('image-only extension rows require customization before post-import mapping', () => {
    const [dto] = mapEtsySoldOrderItemRowsToExternalOrderDtos([{ 'Order ID': '1', 'Transaction ID': '2', 'LNG Expected Files': '2', 'LNG Needs Review': 'true' }]);
    expect(dto.items[0].customizationRawSummary).toMatchObject({ hasCustomization: true, provider: 'ETSY', expectedFileCount: 2, needsReview: true });
  });
  test('groups Etsy sold order item rows into external order dto', () => {
    const [dto] = mapEtsySoldOrderItemRowsToExternalOrderDtos([
      {
        'Sale Date': '06/29/26',
        'Item Name': 'Custom Napkins',
        Quantity: '1',
        Price: '50.95',
        'Order Shipping': '0',
        'Order Sales Tax': '0',
        'Item Total': '50.95',
        Currency: 'USD',
        'Transaction ID': '5121748428',
        'Listing ID': '4527775590',
        'Date Paid': '06/29/2026',
        'Ship Name': 'Buyer Name',
        'Ship Address1': '46 Sunnyside Drive',
        'Ship City': 'Yonkers',
        'Ship State': 'NY',
        'Ship Zipcode': '10705',
        'Ship Country': 'United States',
        'Order ID': '4101302696',
        Variations: 'Quantity:Pack 30pcs,Sizes:6.5X6.5 INCHES,Custom:Dilenia & Milton 20 Years',
        SKU: 'J2614-NK-250626-07',
      },
    ], {
      shopId: '660000000000000000000201',
      shopConnectionId: '660000000000000000000211',
      marketplaceCode: 'ETSY_US',
    });

    expect(dto).toMatchObject({
      source: 'MANUAL_EXCEL',
      importSources: ['MANUAL_EXCEL'],
      salesChannelCode: 'ETSY',
      marketplaceCode: 'ETSY_US',
      externalOrderId: '4101302696',
      orderedAt: '06/29/2026',
      buyer: { name: 'Buyer Name' },
      shippingAddress: {
        name: 'Buyer Name',
        addressLine1: '46 Sunnyside Drive',
        city: 'Yonkers',
        stateOrProvince: 'NY',
        postalCode: '10705',
        countryCode: 'US',
      },
    });
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({
      externalItemId: '5121748428',
      externalListingId: '4527775590',
      sku: 'J2614-NK-250626-07',
      title: 'Custom Napkins',
      quantity: 1,
      variantRaw: 'Quantity:Pack 30pcs,Sizes:6.5X6.5 INCHES,Custom:Dilenia & Milton 20 Years',
      price: {
        currency: 'USD',
        itemPriceAmount: 5095,
        shippingPriceAmount: 0,
        itemTaxAmount: 0,
      },
      customizationRawSummary: {
        hasCustomization: true,
        variations: 'Quantity:Pack 30pcs,Sizes:6.5X6.5 INCHES,Custom:Dilenia & Milton 20 Years',
      },
      externalData: {
        etsy: {
          receiptId: '4101302696',
          transactionId: '5121748428',
          listingId: '4527775590',
        },
      },
    });
  });

  test.each([
    ['Custom Name:Erica'],
    ['Names:THOMAS & MIA,Event Date:04.07.2025'],
    ['Choose Your Design:C — Script Names,Initials:T/M'],
    ['Type printing option:Square,Ink Color:Gold'],
    ['Photo:1 file'],
  ])('marks Etsy variation key as customization: %s', (variations) => {
    const [dto] = mapEtsySoldOrderItemRowsToExternalOrderDtos([{
      'Transaction ID': '5121748428',
      'Order ID': '4101302696',
      Variations: `Quantity:Pack 30pcs,Sizes:4.8x4.8 INCHES,${variations}`,
      SKU: 'J2614-NK-250626-07',
    }], {
      shopId: '660000000000000000000201',
      marketplaceCode: 'ETSY_US',
    });

    expect(dto.items[0].customizationRawSummary.hasCustomization).toBe(true);
  });

  test('does not mark quantity and size only as customization', () => {
    const [dto] = mapEtsySoldOrderItemRowsToExternalOrderDtos([{
      'Transaction ID': '5121748428',
      'Order ID': '4101302696',
      Variations: 'Quantity:Pack 30pcs,Sizes:4.8x4.8 INCHES',
      SKU: 'J2614-NK-250626-07',
    }], {
      shopId: '660000000000000000000201',
      marketplaceCode: 'ETSY_US',
    });

    expect(dto.items[0].customizationRawSummary.hasCustomization).toBe(false);
  });
});
