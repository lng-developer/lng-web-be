const {
  mapEtsySoldOrderItemRowsToExternalOrderDtos,
} = require('../../../../../modules/integration/externalOrderImport/sources/manualExcel/etsySoldOrderItems.mapper');

describe('etsySoldOrderItems.mapper', () => {
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
});
