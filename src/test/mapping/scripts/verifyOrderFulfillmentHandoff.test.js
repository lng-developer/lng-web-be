const {
  extractAmazonOrderIds,
  parseArgs,
  summarizeItemResult,
} = require('../../../modules/mapping/scripts/verifyOrderFulfillmentHandoff');

describe('verifyOrderFulfillmentHandoff script helpers', () => {
  test('extractAmazonOrderIds returns unique Amazon order ids from report text', () => {
    const text = [
      'order-id\torder-item-id',
      '113-7180016-0704235\t163790065888801',
      'noise 114-5128345-1267462 more noise',
      '113-7180016-0704235 duplicate',
    ].join('\n');

    expect(extractAmazonOrderIds(text)).toEqual([
      '113-7180016-0704235',
      '114-5128345-1267462',
    ]);
  });

  test('parseArgs defaults to dry-run and keeps write opt-in explicit', () => {
    expect(parseArgs(['--file=C:\\tmp\\order.txt', '--write=true'])).toMatchObject({
      file: 'C:\\tmp\\order.txt',
      write: true,
      dryRun: false,
    });
    expect(parseArgs([])).toMatchObject({
      write: false,
      dryRun: true,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    });
  });

  test('summarizeItemResult reports dry-run auto-match without pretending production exists', () => {
    const summary = summarizeItemResult({
      item: {
        _id: '660000000000000000000001',
        orderId: '660000000000000000000002',
        externalOrderId: '113-7180016-0704235',
        sku: 'J2508-TS1S-05032026-335',
        status: 'CUSTOMIZATION_PARSED',
      },
      preview: {
        ready: true,
        blockingReasons: [],
        autoMatch: {
          vendorProductId: '660000000000000000000003',
          vendorCostCenterId: '660000000000000000000004',
        },
      },
      plan: null,
      task: null,
      write: false,
    });

    expect(summary).toMatchObject({
      matched: true,
      wouldResolve: true,
      productionTaskCreated: false,
      unmatchedReason: null,
    });
  });

  test('summarizeItemResult reports blocking reasons when preview is blocked', () => {
    const summary = summarizeItemResult({
      item: {
        _id: '660000000000000000000001',
        externalOrderId: '113-7180016-0704235',
        sku: 'J2508-TS1S-05032026-335',
      },
      preview: {
        ready: false,
        blockingReasons: ['NO_VENDOR_COST_CENTER_CANDIDATE'],
        autoMatch: null,
      },
      plan: null,
      task: null,
      write: false,
    });

    expect(summary).toMatchObject({
      matched: false,
      wouldResolve: false,
      unmatchedReason: 'NO_VENDOR_COST_CENTER_CANDIDATE',
    });
  });
});
