jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(() => false),
}));
jest.mock('../../../src/modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
}));
jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));
jest.mock('../../../src/modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
}));
jest.mock('../../../src/modules/design/public', () => ({
  createPsdTemplateTaskFromListingVariant: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));

const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const mappingPublic = require('../../../src/modules/mapping/public');
const designPublic = require('../../../src/modules/design/public');
const auditPublic = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/order/services/orderDesignRequest.service');

describe('orderDesignRequest.service', () => {
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';
  const listingId = '660000000000000000000501';
  const listingVariantId = '660000000000000000000601';
  const accountId = '660000000000000000000901';

  beforeEach(() => {
    jest.clearAllMocks();
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId: '660000000000000000000201',
      listingId,
    });
    orderRepository.findById.mockResolvedValue({
      _id: orderId,
      shopId: '660000000000000000000201',
      externalOrderId: '114-1',
      assignedStaffIds: [accountId],
    });
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      orderItemId,
      listingVariantId,
    });
    designPublic.createPsdTemplateTaskFromListingVariant.mockResolvedValue({
      id: '660000000000000000000701',
      taskType: 'PSD_TEMPLATE',
    });
  });

  test('assigned sale can request PSD for own order item without catalog write', async () => {
    const auth = {
      accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000801', permissions: ['ORDERS:READ'] }],
    };

    const result = await service.requestPsdForOrderItem(orderItemId, { note: 'Need PSD' }, auth);

    expect(mappingPublic.getFulfillmentPlanForOrderItem).toHaveBeenCalledWith(
      orderItemId,
      expect.objectContaining({ system: true, source: 'ORDER_DESIGN_REQUEST_PLAN_READ' }),
    );
    expect(designPublic.createPsdTemplateTaskFromListingVariant).toHaveBeenCalledWith(
      listingId,
      listingVariantId,
      { note: 'Need PSD' },
      expect.objectContaining({ system: true, source: 'ORDER_DESIGN_REQUEST', accountId }),
    );
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ITEM_PSD_REQUESTED',
      entityType: 'ORDER_ITEM',
      entityId: orderItemId,
      scopeType: 'SHOP',
    }), expect.any(Object));
    expect(result).toMatchObject({ taskType: 'PSD_TEMPLATE' });
  });

  test('unassigned sale cannot request PSD for another order', async () => {
    orderRepository.findById.mockResolvedValueOnce({
      _id: orderId,
      shopId: '660000000000000000000201',
      assignedStaffIds: ['660000000000000000000902'],
    });

    await expect(service.requestPsdForOrderItem(orderItemId, {}, {
      accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000801', permissions: ['ORDERS:READ'] }],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    expect(designPublic.createPsdTemplateTaskFromListingVariant).not.toHaveBeenCalled();
  });

  test('requires mapped listing variant before requesting PSD', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({ orderItemId });

    await expect(service.requestPsdForOrderItem(orderItemId, {}, {
      permissions: ['ORDERS:READ'],
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });

    expect(designPublic.createPsdTemplateTaskFromListingVariant).not.toHaveBeenCalled();
  });
});
