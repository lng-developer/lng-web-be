jest.mock('../../../src/modules/order/repositories/orderWorkbenchProjection.repository', () => ({
  upsertBase: jest.fn(),
  setOrderFields: jest.fn(),
  setItemFields: jest.fn(),
}));

const repository = require('../../../src/modules/order/repositories/orderWorkbenchProjection.repository');
const service = require('../../../src/modules/order/services/orderWorkbenchProjection.service');

describe('orderWorkbenchProjection.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a compact base without order external data', async () => {
    await service.upsertOrderWorkbenchBase({
      _id: '660000000000000000000001', shopId: '660000000000000000000002', status: 'IMPORTED',
      externalOrderId: '114-1', externalData: { raw: 'must-not-persist' },
    }, [{
      _id: '660000000000000000000003', orderId: '660000000000000000000001', sku: 'J2501-TS2S',
    }]);

    expect(repository.upsertBase).toHaveBeenCalledWith(expect.objectContaining({
      orderId: '660000000000000000000001',
      shopId: '660000000000000000000002',
      externalOrderId: '114-1',
      order: expect.not.objectContaining({ externalData: expect.anything() }),
      items: [expect.objectContaining({ orderItemId: '660000000000000000000003' })],
    }), {});
  });

  test('rejects item patch fields outside the workbench contract', async () => {
    await expect(service.updateOrderWorkbenchItem('order-1', 'item-1', {
      rawCustomization: { secret: true },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('accepts compact patches for manually edited order and item fields', async () => {
    await service.updateOrderWorkbenchOrder('order-1', {
      assignedStaffIds: ['staff-1'],
      'order.buyer': { name: 'Updated buyer' },
      'order.paymentStatus': 'REFUNDED',
      deliveredAt: new Date('2026-09-17T00:00:00.000Z'),
    });
    await service.updateOrderWorkbenchItem('order-1', 'item-1', {
      'item.listingId': null,
      'item.csNote': null,
    });

    expect(repository.setOrderFields).toHaveBeenCalledTimes(1);
    expect(repository.setItemFields).toHaveBeenCalledWith('order-1', 'item-1', {
      'item.listingId': null,
      'item.csNote': null,
    }, {});
  });

  test('upserts an assembled workbench row with its compact source subtrees', async () => {
    await service.upsertOrderWorkbenchRow({
      order: { _id: '660000000000000000000001', shopId: '660000000000000000000002', externalOrderId: '114-1' },
      shop: { id: '660000000000000000000002', name: 'US Store' },
      case: { id: 'case-1', title: 'Address issue' },
      items: [{
        item: { _id: '660000000000000000000003', orderId: '660000000000000000000001', sku: 'J2501-TS2S' },
        customization: { status: 'PARSED' }, fulfillmentPlan: { status: 'READY' }, production: { qcStatus: 'APPROVED' },
      }],
    });

    expect(repository.upsertBase).toHaveBeenCalledWith(expect.objectContaining({
      shop: { id: '660000000000000000000002', name: 'US Store' },
      case: { id: 'case-1', title: 'Address issue' },
      items: [expect.objectContaining({
        customization: { status: 'PARSED' }, fulfillmentPlan: { status: 'READY' }, production: { qcStatus: 'APPROVED' },
      })],
      hasCurrentPsd: false,
    }), {});
  });
});
