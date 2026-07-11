jest.mock('../../../modules/order/repositories/orderCase.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
  countOpenByOrder: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateCaseStatus: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

const repository = require('../../../modules/order/repositories/orderCase.repository');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const authPublic = require('../../../modules/auth/public');
const orderTimelineService = require('../../../modules/order/services/orderTimeline.service');
const service = require('../../../modules/order/services/orderCase.service');

describe('orderCase.service', () => {
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';
  const caseId = '660000000000000000000701';

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId });
    orderItemRepository.findById.mockResolvedValue({ _id: orderItemId, orderId, shopId });
    authPublic.canAccessScope.mockReturnValue(true);
    repository.create.mockResolvedValue({
      _id: caseId,
      orderId,
      orderItemId,
      shopId,
      status: 'OPEN',
      title: 'Need replacement',
    });
    repository.findById.mockResolvedValue({
      _id: caseId,
      orderId,
      orderItemId,
      shopId,
      status: 'OPEN',
      title: 'Need replacement',
    });
    repository.update.mockResolvedValue({
      _id: caseId,
      orderId,
      shopId,
      status: 'RESOLVED',
      title: 'Need replacement',
      resolutionNote: 'Done',
    });
    repository.countOpenByOrder.mockResolvedValue(0);
  });

  test('creates case and marks order open', async () => {
    const result = await service.createOrderCase({
      orderId,
      orderItemId,
      caseType: 'REPLACEMENT',
      severity: 'HIGH',
      title: 'Need replacement',
      description: 'Buyer requested replacement',
    }, { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001' });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      status: 'OPEN',
      createdBy: '660000000000000000009001',
    }));
    expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'OPEN');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_CASE_OPENED',
      source: 'USER',
      actorId: '660000000000000000009001',
    }));
    expect(result).toEqual(expect.objectContaining({ id: caseId, status: 'OPEN' }));
  });

  test('rejects order item from another order', async () => {
    orderItemRepository.findById.mockResolvedValueOnce({
      _id: orderItemId,
      orderId: '660000000000000000000999',
      shopId,
    });

    await expect(service.createOrderCase({ orderId, orderItemId, title: 'Bad item' }, { permissions: ['ORDERS:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('resolve closes order case status when no open cases remain', async () => {
    await service.resolveOrderCase(caseId, { resolutionNote: 'Done' }, {
      permissions: ['ORDERS:WRITE'],
      accountId: '660000000000000000009001',
    });

    expect(repository.update).toHaveBeenCalledWith(caseId, expect.objectContaining({
      status: 'RESOLVED',
      resolutionNote: 'Done',
      resolvedBy: '660000000000000000009001',
    }));
    expect(repository.countOpenByOrder).toHaveBeenCalledWith(orderId);
    expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'NONE');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_CASE_RESOLVED',
      source: 'USER',
      actorId: '660000000000000000009001',
    }));
  });

  test('cancel keeps order open when another open case remains', async () => {
    repository.countOpenByOrder.mockResolvedValueOnce(1);

    await service.cancelOrderCase(caseId, { cancelReason: 'Duplicate' }, {
      permissions: ['ORDERS:WRITE'],
      accountId: '660000000000000000009001',
    });

    expect(repository.update).toHaveBeenCalledWith(caseId, expect.objectContaining({
      status: 'CANCELLED',
      cancelReason: 'Duplicate',
    }));
    expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'OPEN');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_CASE_CANCELLED',
      source: 'USER',
      actorId: '660000000000000000009001',
    }));
  });

  test('scoped user cannot write another shop case', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.updateOrderCase(caseId, { title: 'New' }, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
