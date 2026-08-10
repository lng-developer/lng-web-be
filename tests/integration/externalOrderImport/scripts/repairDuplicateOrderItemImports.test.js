jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  listByExternalOrderId: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../../src/modules/order/public', () => ({
  importExternalOrder: jest.fn(),
}));

const rawRecordRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const jobRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository');
const orderPublic = require('../../../../src/modules/order/public');
const {
  parseRepairArgs,
  repairDuplicateOrderItemImports,
} = require('../../../../src/modules/integration/externalOrderImport/scripts/repairDuplicateOrderItemImports');

describe('repairDuplicateOrderItemImports', () => {
  const rawRecords = [
    {
      _id: '660000000000000000000501',
      importJobId: '660000000000000000000601',
      rowNumber: 1,
      rawRecord: {
        'order-id': '114-1',
        'order-item-id': 'ITEM-1',
        sku: 'SKU-1',
        'product-name': 'Personalized Shirt',
        'quantity-purchased': '1',
        currency: 'USD',
        'item-price': '35.30',
        'customized-url': 'https://example.test/custom.zip',
      },
    },
    {
      _id: '660000000000000000000502',
      importJobId: '660000000000000000000601',
      rowNumber: 2,
      rawRecord: {
        'order-id': '114-1',
        'order-item-id': 'ITEM-1',
        sku: '',
        'product-name': '',
        'quantity-purchased': '',
        currency: '',
        'item-price': '',
        'customized-url': '',
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    rawRecordRepository.listByExternalOrderId.mockResolvedValue(rawRecords);
    jobRepository.findById.mockResolvedValue({
      _id: '660000000000000000000601',
      shopId: '660000000000000000000201',
      shopConnectionId: null,
      marketplaceCode: 'AMAZON_US',
      externalAccountId: null,
    });
    orderPublic.importExternalOrder.mockResolvedValue({
      orderId: '660000000000000000000301',
      itemResults: [{ orderItemId: '660000000000000000000401', externalItemId: 'ITEM-1' }],
    });
  });

  test('parseRepairArgs defaults to dry-run and requires externalOrderId', () => {
    expect(parseRepairArgs(['--externalOrderId=114-1'])).toEqual({
      externalOrderId: '114-1',
      dryRun: true,
    });
    expect(parseRepairArgs(['--externalOrderId=114-1', '--dryRun=false'])).toEqual({
      externalOrderId: '114-1',
      dryRun: false,
    });
    expect(() => parseRepairArgs([])).toThrow('--externalOrderId is required');
  });

  test('dry-run builds merged item dto without importing', async () => {
    const result = await repairDuplicateOrderItemImports({ externalOrderId: '114-1' });

    expect(orderPublic.importExternalOrder).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.dto.items).toHaveLength(1);
    expect(result.dto.items[0]).toMatchObject({
      externalItemId: 'ITEM-1',
      sku: 'SKU-1',
      title: 'Personalized Shirt',
      rawRecordId: '660000000000000000000501',
      rawRecordIds: ['660000000000000000000501', '660000000000000000000502'],
      customizationRawSummary: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
      },
    });
  });

  test('mutating mode imports merged item dto', async () => {
    const result = await repairDuplicateOrderItemImports({ externalOrderId: '114-1', dryRun: false });

    expect(orderPublic.importExternalOrder).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: '114-1',
      items: [expect.objectContaining({
        externalItemId: 'ITEM-1',
        rawRecordIds: ['660000000000000000000501', '660000000000000000000502'],
      })],
    }));
    expect(result.dryRun).toBe(false);
    expect(result.importResult).toMatchObject({
      orderId: '660000000000000000000301',
    });
  });
});
