jest.mock('../../../modules/order/repositories/order.repository', () => ({
  updateCostCenterStatus: jest.fn(),
  updatePsdStatus: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  listByOrder: jest.fn(),
}));

jest.mock('../../../modules/mapping/public', () => ({
  listFulfillmentPlansForOrderItems: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  getListingSummariesByIds: jest.fn(),
}));

const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const mappingPublic = require('../../../modules/mapping/public');
const catalogPublic = require('../../../modules/catalog/public');
const service = require('../../../modules/order/services/orderCostCenterStatus.service');

describe('orderCostCenterStatus.service', () => {
  const orderId = '660000000000000000000301';
  const itemA = '660000000000000000000401';
  const itemB = '660000000000000000000402';

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.updateCostCenterStatus.mockResolvedValue({ _id: orderId });
    orderRepository.updatePsdStatus.mockResolvedValue({ _id: orderId });
  });

  test('marks order PRESENT when every item has a vendor cost center plan', async () => {
    orderItemRepository.listByOrder.mockResolvedValueOnce({
      items: [{ _id: itemA }, { _id: itemB }],
    });
    mappingPublic.listFulfillmentPlansForOrderItems.mockResolvedValueOnce([
      { orderItemId: itemA, vendorCostCenter: { id: 'cc1' } },
      { orderItemId: itemB, vendorCostCenter: { id: 'cc2' } },
    ]);

    await service.updateCostCenterStatusForOrder(orderId);

    expect(orderRepository.updateCostCenterStatus).toHaveBeenCalledWith(orderId, 'PRESENT');
  });

  test('marks order MISSING when any item has no vendor cost center plan', async () => {
    orderItemRepository.listByOrder.mockResolvedValueOnce({
      items: [{ _id: itemA }, { _id: itemB }],
    });
    mappingPublic.listFulfillmentPlansForOrderItems.mockResolvedValueOnce([
      { orderItemId: itemA, vendorCostCenter: { id: 'cc1' } },
    ]);

    await service.updateCostCenterStatusForOrder(orderId);

    expect(orderRepository.updateCostCenterStatus).toHaveBeenCalledWith(orderId, 'MISSING');
  });

  test('marks order PSD PRESENT when every item listing has PSD', async () => {
    orderItemRepository.listByOrder.mockResolvedValueOnce({
      items: [{ _id: itemA, listingId: '660000000000000000000801' }],
    });
    mappingPublic.listFulfillmentPlansForOrderItems.mockResolvedValueOnce([]);
    catalogPublic.getListingSummariesByIds.mockResolvedValueOnce([{
      id: '660000000000000000000801',
      psdStatus: 'PRESENT',
    }]);

    await service.updatePsdStatusForOrder(orderId);

    expect(orderRepository.updatePsdStatus).toHaveBeenCalledWith(orderId, 'PRESENT');
  });

  test('marks order PSD MISSING when any item has no PSD listing', async () => {
    orderItemRepository.listByOrder.mockResolvedValueOnce({
      items: [{ _id: itemA, listingId: '660000000000000000000801' }, { _id: itemB }],
    });
    mappingPublic.listFulfillmentPlansForOrderItems.mockResolvedValueOnce([]);
    catalogPublic.getListingSummariesByIds.mockResolvedValueOnce([{
      id: '660000000000000000000801',
      psdStatus: 'PRESENT',
    }]);

    await service.updatePsdStatusForOrder(orderId);

    expect(orderRepository.updatePsdStatus).toHaveBeenCalledWith(orderId, 'MISSING');
  });
});
