jest.mock('../../../src/modules/order/repositories/orderWorkbenchProjection.repository', () => ({
  createBase: jest.fn(),
  upsertBase: jest.fn(),
  setOrderFields: jest.fn(),
  setItemFields: jest.fn(),
  setListingImageByListingId: jest.fn(),
  setListingPsdTemplateAssetByListingId: jest.fn(),
  setListingVariantPsdById: jest.fn(),
}));

jest.mock('../../../src/modules/shop/public', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderQuery.service', () => ({
  getOrder: jest.fn(),
  listOrderWorkbench: jest.fn(),
}));

const repository = require('../../../src/modules/order/repositories/orderWorkbenchProjection.repository');
const shopPublic = require('../../../src/modules/shop/public');
const orderQueryService = require('../../../src/modules/order/services/orderQuery.service');
const service = require('../../../src/modules/order/services/orderWorkbenchProjection.service');

describe('orderWorkbenchProjection.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shopPublic.findById.mockResolvedValue({ _id: '660000000000000000000002', name: 'US Store' });
  });
  test('preserves Etsy display fields without projecting raw provider data', async () => {
    await service.upsertOrderWorkbenchBase({ _id: 'o', shopId: 's' }, [{ _id: 'i', salesChannelCode: 'ETSY', externalListingId: '123', variantRaw: 'Size: L', externalData: { etsy: { listingImageUrl: 'https://i.etsystatic.com/123/a.jpg', secret: 'hidden' } } }]);
    const item = repository.createBase.mock.calls[0][0].items[0].item;
    expect(item).toMatchObject({ salesChannelCode: 'ETSY', externalListingId: '123', variations: 'Size: L', listingImageUrl: 'https://i.etsystatic.com/123/a.jpg' });
    expect(item).not.toHaveProperty('externalData');
  });

  test('creates a compact base without order external data', async () => {
    await service.upsertOrderWorkbenchBase({
      _id: '660000000000000000000001', shopId: '660000000000000000000002', status: 'IMPORTED',
      externalOrderId: '114-1', externalData: { raw: 'must-not-persist' },
    }, [{
      _id: '660000000000000000000003', orderId: '660000000000000000000001', sku: 'J2501-TS2S',
    }]);

    expect(repository.createBase).toHaveBeenCalledWith(expect.objectContaining({
      orderId: '660000000000000000000001',
      shopId: '660000000000000000000002',
      externalOrderId: '114-1',
      order: expect.not.objectContaining({ externalData: expect.anything() }),
      items: [expect.objectContaining({ orderItemId: '660000000000000000000003' })],
      shop: expect.objectContaining({ name: 'US Store' }),
    }), {});
  });

  test('syncs the order shop snapshot when creating a base projection', async () => {
    await service.upsertOrderWorkbenchBase({
      _id: '660000000000000000000001', shopId: '660000000000000000000002', externalOrderId: '114-1',
    });

    expect(repository.createBase).toHaveBeenCalledWith(expect.objectContaining({
      shop: { id: '660000000000000000000002', name: 'US Store' },
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

  test('updates only the listing-image snapshot for projections linked to a listing', async () => {
    await service.syncOrderWorkbenchListingImage(
      '660000000000000000000003',
      'https://res.cloudinary.com/example/listing.jpg',
    );

    expect(repository.setListingImageByListingId).toHaveBeenCalledWith(
      '660000000000000000000003',
      'https://res.cloudinary.com/example/listing.jpg',
    );
  });

  test('updates only the listing PSD snapshot for projections linked to a listing', async () => {
    await service.syncOrderWorkbenchListingPsd(
      '660000000000000000000003',
      '660000000000000000000901',
    );

    expect(repository.setListingPsdTemplateAssetByListingId).toHaveBeenCalledWith(
      '660000000000000000000003',
      '660000000000000000000901',
    );
  });

  test('updates only the variant PSD snapshot for projections linked to a variant', async () => {
    await service.syncOrderWorkbenchListingVariantPsd(
      '660000000000000000000004',
      '660000000000000000000901',
      { status: 'PRESENT' },
    );

    expect(repository.setListingVariantPsdById).toHaveBeenCalledWith(
      '660000000000000000000004',
      '660000000000000000000901',
      { status: 'PRESENT' },
    );
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

  test('rebuilds an existing projection from the source workbench row', async () => {
    const order = {
      _id: '660000000000000000000001',
      externalOrderId: '114-1',
      shopId: '660000000000000000000002',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    };
    const row = {
      order: { ...order, shopId: '660000000000000000000002' },
      shop: { id: '660000000000000000000002', name: 'US Store' },
      items: [{
        item: { _id: '660000000000000000000003', orderId: order._id, sku: 'J2501-TS2S' },
        listing: { id: 'listing-1', productImageUrl: 'https://res.cloudinary.com/lng/main.jpg' },
        customization: { status: 'PARSED', customerInputs: { images: [{ assetId: 'asset-1' }] } },
      }],
    };
    orderQueryService.getOrder.mockResolvedValue(order);
    orderQueryService.listOrderWorkbench.mockResolvedValue({ items: [row] });

    await service.rebuildOrderWorkbenchProjection(order._id, { permissions: ['ORDERS:WRITE'] });

    expect(orderQueryService.listOrderWorkbench).toHaveBeenCalledWith(
      {
        orderId: '114-1',
        shopId: '660000000000000000000002',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        page: 1,
        limit: 1,
      },
      { permissions: ['ORDERS:WRITE'] },
      { forceSourceRead: true },
    );
    expect(repository.upsertBase).toHaveBeenCalledWith(expect.objectContaining({
      orderId: order._id,
      items: [expect.objectContaining({
        listing: expect.objectContaining({ productImageUrl: 'https://res.cloudinary.com/lng/main.jpg' }),
        customization: expect.objectContaining({ status: 'PARSED' }),
      })],
    }), { source: 'ORDER_WORKBENCH_REBUILD' });
  });
});
