const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));

jest.mock('../../../src/modules/order/repositories/orderCase.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findOpenByOrderAndType: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
  addComment: jest.fn(),
  countOpenByOrder: jest.fn(),
}));

jest.mock('../../../src/modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateCaseStatus: jest.fn(),
}));

jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderNotification.service', () => ({
  notifyAssignedStaff: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));

const repository = require('../../../src/modules/order/repositories/orderCase.repository');
const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const authPublic = require('../../../src/modules/auth/public');
const orderTimelineService = require('../../../src/modules/order/services/orderTimeline.service');
const orderNotificationService = require('../../../src/modules/order/services/orderNotification.service');
const auditPublic = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/order/services/orderCase.service');

describe('orderCase.service', () => {
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';
  const caseId = '660000000000000000000701';

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId, assignedStaffIds: ['660000000000000000009002'] });
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
    repository.addComment.mockResolvedValue({
      _id: caseId,
      orderId,
      orderItemId,
      shopId,
      status: 'OPEN',
      title: 'Need replacement',
      comments: [{ body: 'Buyer confirmed', createdBy: '660000000000000000009001' }],
    });
    repository.countOpenByOrder.mockResolvedValue(0);
    repository.findOpenByOrderAndType.mockResolvedValue(null);
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
    }), { session: mockSession });
    expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'OPEN', { session: mockSession });
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_CASE_OPENED',
      source: 'USER',
      actorId: '660000000000000000009001',
    }), { session: mockSession });
    expect(result).toEqual(expect.objectContaining({ id: caseId, status: 'OPEN' }));
    expect(orderNotificationService.notifyAssignedStaff).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.objectContaining({ _id: orderId }),
      actorAccountId: '660000000000000000009001',
      type: 'ORDER_CASE_CREATED',
      deduplicationScope: caseId,
    }));
  });

  test('ensureOpenOrderCase reuses an existing open case for the same type', async () => {
    repository.findOpenByOrderAndType.mockResolvedValueOnce({
      _id: caseId,
      orderId,
      orderItemId: null,
      shopId,
      status: 'OPEN',
      caseType: 'ADDRESS',
      title: 'Address validation failed',
    });

    const result = await service.ensureOpenOrderCase({
      orderId,
      caseType: 'ADDRESS',
      title: 'Address validation failed',
    }, { system: true });

    expect(repository.findOpenByOrderAndType).toHaveBeenCalledWith(orderId, 'ADDRESS');
    expect(repository.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: caseId, caseType: 'ADDRESS', status: 'OPEN' });
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
    }), { session: mockSession, expectedStatus: 'OPEN' });
    expect(repository.countOpenByOrder).toHaveBeenCalledWith(orderId, { session: mockSession });
    expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'NONE', { session: mockSession });
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_CASE_RESOLVED',
      source: 'USER',
      actorId: '660000000000000000009001',
    }), { session: mockSession });
    expect(orderNotificationService.notifyAssignedStaff).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ORDER_CASE_RESOLVED',
      deduplicationScope: caseId,
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
    }), { session: mockSession, expectedStatus: 'OPEN' });
    expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'OPEN', { session: mockSession });
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_CASE_CANCELLED',
      source: 'USER',
      actorId: '660000000000000000009001',
    }), { session: mockSession });
  });

  test('adds case comment and appends timeline', async () => {
    const result = await service.addOrderCaseComment(caseId, { body: 'Buyer confirmed' }, {
      permissions: ['ORDERS:WRITE'],
      accountId: '660000000000000000009001',
    });

    expect(repository.addComment).toHaveBeenCalledWith(caseId, expect.objectContaining({
      body: 'Buyer confirmed',
      createdBy: '660000000000000000009001',
    }), { session: mockSession });
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_CASE_COMMENT_ADDED',
      source: 'USER',
      actorId: '660000000000000000009001',
    }), { session: mockSession });
    expect(orderNotificationService.notifyAssignedStaff).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ORDER_CASE_COMMENT_ADDED',
      deduplicationScope: caseId,
    }));
    expect(result.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({ body: 'Buyer confirmed' }),
    ]));
  });

  test('scoped user cannot write another shop case', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.updateOrderCase(caseId, { title: 'New' }, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('lists cases for a user with scoped write permission', async () => {
    repository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    await service.listOrderCases({}, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }],
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ shopIds: [shopId] }));
  });

  test('reads a case for a user with scoped write permission', async () => {
    authPublic.canAccessScope.mockImplementation((_context, permission) => permission === 'ORDERS:WRITE');

    await expect(service.getOrderCase(caseId, { permissions: [], scopes: [] }))
      .resolves.toEqual(expect.objectContaining({ id: caseId }));
  });

  test.each([
    ['resolve', () => service.resolveOrderCase(caseId, { resolutionNote: 'Done' }, {
      permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001',
    })],
    ['cancel', () => service.cancelOrderCase(caseId, { cancelReason: 'Duplicate' }, {
      permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001',
    })],
  ])('%s loses a concurrent OPEN case transition without writing evidence', async (_action, execute) => {
    repository.update.mockResolvedValueOnce(null);

    await expect(execute()).rejects.toMatchObject({ statusCode: 409 });

    expect(repository.update).toHaveBeenCalledWith(caseId, expect.any(Object), {
      session: mockSession,
      expectedStatus: 'OPEN',
    });
    expect(repository.countOpenByOrder).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test.each([
    ['ORDER_CASE_CREATED', () => service.createOrderCase({
      orderId, orderItemId, title: 'private case title', description: 'private case body',
    }, { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001' })],
    ['ORDER_CASE_UPDATED', () => service.updateOrderCase(caseId, {
      title: 'private case title', severity: 'HIGH',
    }, { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001' })],
    ['ORDER_CASE_RESOLVED', () => service.resolveOrderCase(caseId, {
      resolutionNote: 'private resolution note',
    }, { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001' })],
    ['ORDER_CASE_CANCELLED', () => service.cancelOrderCase(caseId, {
      cancelReason: 'private cancellation reason',
    }, { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001' })],
    ['ORDER_CASE_COMMENT_ADDED', () => service.addOrderCaseComment(caseId, {
      body: 'private case comment',
    }, { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000009001' })],
  ])('records sanitized %s evidence without raw case text', async (action, execute) => {
    await execute();

    const [event, options] = auditPublic.record.mock.calls.at(-1);
    expect(event).toMatchObject({
      actorType: 'ACCOUNT', action, entityType: 'ORDER_CASE', scopeType: 'SHOP', scopeId: shopId,
    });
    expect(options).toEqual({ session: mockSession });
    expect(JSON.stringify(event)).not.toMatch(/private (case|resolution|cancellation)/);
  });
});
