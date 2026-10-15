jest.mock('../../../src/modules/shop/public', () => ({ findById: jest.fn(async () => ({ _id: 's', name: 'Etsy shop' })) }));
jest.mock('../../../src/modules/order/repositories/orderWorkbenchProjection.repository', () => ({
  upsertBase: jest.fn(),
  setOrderFields: jest.fn(),
  setItemFields: jest.fn(),
}));

const repository = require('../../../src/modules/order/repositories/orderWorkbenchProjection.repository');
const service = require('../../../src/modules/order/services/orderWorkbenchProjection.service');

describe('orderWorkbenchProjection.service', () => {
  test('preserves Etsy display fields without projecting raw provider data', async () => {
    await service.upsertOrderWorkbenchBase({ _id: 'o', shopId: 's' }, [{ _id: 'i', salesChannelCode: 'ETSY', externalListingId: '123', variantRaw: 'Size: L', externalData: { etsy: { listingImageUrl: 'https://i.etsystatic.com/123/a.jpg', secret: 'hidden' } } }]);
    const item = repository.upsertBase.mock.calls[0][0].items[0].item;
    expect(item).toMatchObject({ salesChannelCode: 'ETSY', externalListingId: '123', variations: 'Size: L', listingImageUrl: 'https://i.etsystatic.com/123/a.jpg' });
    expect(item).not.toHaveProperty('externalData');
  });
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
      shop: expect.objectContaining({ name: 'Etsy shop' }),
    }), { preserveEnrichment: true });
  });

  test('rejects item patch fields outside the workbench contract', async () => {
    await expect(service.updateOrderWorkbenchItem('order-1', 'item-1', {
      rawCustomization: { secret: true },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
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
