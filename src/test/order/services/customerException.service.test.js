jest.mock('../../../modules/order/services/orderQuery.service', () => ({
  listCustomerExceptionCandidates: jest.fn(),
  listOrderWorkbench: jest.fn(),
}));

const orderQueryService = require('../../../modules/order/services/orderQuery.service');
const service = require('../../../modules/order/services/customerException.service');

describe('customerException.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('derives CS exception queue from workbench rows', async () => {
    orderQueryService.listCustomerExceptionCandidates.mockResolvedValue({
      items: [{
        order: {
          _id: '660000000000000000000301',
          shopId: '660000000000000000000201',
          externalOrderId: '114-1',
          addressValidationStatus: 'INVALID',
          caseStatus: 'OPEN',
        },
        items: [{
          item: {
            _id: '660000000000000000000401',
            sku: 'J2508-TS1S',
            status: 'NEED_PRODUCTION',
            customizationRawSummary: { hasCustomization: true },
          },
          customization: null,
          tracking: { status: 'EXCEPTION' },
        }, {
          item: {
            _id: '660000000000000000000403',
            sku: 'J2508-TS1S-R2',
            status: 'SHIPPED',
          },
          customization: null,
          tracking: { status: 'RETURNED' },
        }, {
          item: {
            _id: '660000000000000000000402',
            sku: 'J2508-TS1S-R1',
            status: 'NEW',
            replacementOfOrderItemId: '660000000000000000000401',
          },
          customization: { status: 'PARSED' },
          tracking: null,
        }],
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await service.listCustomerExceptions({ page: 1, limit: 20 }, { permissions: ['ORDERS:READ'] });

    expect(result.items.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'ADDRESS_INVALID',
      'OPEN_CASE',
      'CUSTOMIZATION_NOT_READY',
      'SHIPMENT_EXCEPTION',
      'SHIPMENT_RETURNED',
      'REPLACEMENT_PENDING',
    ]));
    expect(orderQueryService.listCustomerExceptionCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
      expect.objectContaining({ permissions: ['ORDERS:READ'] }),
    );
    expect(orderQueryService.listOrderWorkbench).not.toHaveBeenCalled();
  });

  test('identifies exception rows as a preview of the paged orders', async () => {
    orderQueryService.listCustomerExceptionCandidates.mockResolvedValue({
      items: [{
        order: {
          _id: '660000000000000000000301',
          shopId: '660000000000000000000201',
          addressValidationStatus: 'INVALID',
          caseStatus: 'OPEN',
        },
        items: [],
      }],
      total: 41,
      page: 2,
      limit: 20,
    });

    const result = await service.listCustomerExceptions({ page: 2, limit: 20 });

    expect(result.items).toHaveLength(2);
    expect(result).toMatchObject({
      items: expect.any(Array),
      paginationUnit: 'ORDERS',
      orderPagination: { total: 41, page: 2, limit: 20 },
    });
    expect(result).not.toHaveProperty('total');
    expect(result).not.toHaveProperty('page');
    expect(result).not.toHaveProperty('limit');
  });

  test('filters by caseType and reason', async () => {
    orderQueryService.listCustomerExceptionCandidates.mockResolvedValue({
      items: [{
        order: { _id: '660000000000000000000301', shopId: '660000000000000000000201' },
        items: [{
          item: {
            _id: '660000000000000000000401',
            status: 'NEW',
            customizationRawSummary: { hasCustomization: true },
          },
          customization: null,
        }],
      }],
    });

    const result = await service.listCustomerExceptions({
      caseType: 'CUSTOMIZATION',
      reason: 'CUSTOMIZATION_NOT_READY',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      caseType: 'CUSTOMIZATION',
      reason: 'CUSTOMIZATION_NOT_READY',
    });
  });
});
