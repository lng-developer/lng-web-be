const { toVendorSubmissionDto } = require('../../../src/modules/vendorSubmission/dtos/vendorSubmission.dto');

describe('vendorSubmission.dto', () => {
  test('exposes display fields from safe payload snapshot', () => {
    const dto = toVendorSubmissionDto({
      _id: '660000000000000000120001',
      productionTaskId: '660000000000000000120002',
      orderId: '660000000000000000120003',
      orderItemId: '660000000000000000120004',
      shopId: '660000000000000000120005',
      status: 'READY',
      vendorExternalOrderId: 'MZ-ORDER-1',
      payloadSnapshot: {
        orderItem: {
          externalOrderId: '112-1234567-1234567',
          sku: 'J2520-TS1',
          title: 'Personalized Shirt',
        },
        listing: {
          title: 'Listing Title',
          sku: 'LISTING-SKU',
        },
        vendorProduct: {
          name: 'Vendor Product',
          vendor: { name: 'Merchize' },
        },
        vendorCostCenter: {
          code: 'CC-TS-M-BLACK',
        },
      },
    });

    expect(dto).toMatchObject({
      externalOrderId: '112-1234567-1234567',
      listingTitle: 'Listing Title',
      sku: 'J2520-TS1',
      vendorName: 'Merchize',
      vendorProductName: 'Vendor Product',
      costCenterCode: 'CC-TS-M-BLACK',
    });
  });
});
