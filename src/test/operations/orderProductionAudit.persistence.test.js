const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../modules/auth/public', () => ({ canAccessScope: jest.fn(() => true) }));
jest.mock('../../modules/hr/public', () => ({ listAssignableProfiles: jest.fn() }));
jest.mock('../../modules/organization/public', () => ({ listAccountOrganizationSummaries: jest.fn() }));
jest.mock('../../modules/vendorSubmission/public', () => ({
  getByOrderItemId: jest.fn(),
}));
jest.mock('../../modules/order/public', () => ({
  addressValidationStatuses: { VALID: 'VALID', OVERRIDDEN: 'OVERRIDDEN' },
  appendTimeline: jest.fn(),
  findItemById: jest.fn(),
  transitionItemStatus: jest.fn(),
}));

const auditPublic = require('../../modules/audit/public');
const hrPublic = require('../../modules/hr/public');
const organizationPublic = require('../../modules/organization/public');
const orderPublic = require('../../modules/order/public');
const Order = require('../../modules/order/models/order.model');
const OrderItem = require('../../modules/order/models/orderItem.model');
const ProductionTask = require('../../modules/production/models/productionTask.model');
const orderAssignmentService = require('../../modules/order/services/orderAssignment.service');
const orderItemCancelService = require('../../modules/order/services/orderItemCancel.service');
const productionTaskService = require('../../modules/production/services/productionTask.service');
const vendorSubmissionPublic = require('../../modules/vendorSubmission/public');

describe('Order and Production audit transaction rollback', () => {
  let database;
  const orderId = new mongoose.Types.ObjectId();
  const orderItemId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const shopId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const assigneeId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await Promise.all([Order.deleteMany({}), OrderItem.deleteMany({}), ProductionTask.deleteMany({})]);
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValue(null);
  });

  test('Order assignment rolls back when its transaction-scoped audit fails', async () => {
    await Order.collection.insertOne({ _id: orderId, shopId, assignedStaffId: null });

    await expect(orderAssignmentService.assignStaff(String(orderId), [String(assigneeId)], {
      accountId: String(actorId), permissions: ['ORDERS:WRITE'],
    })).rejects.toThrow('audit unavailable');

    expect((await Order.findById(orderId).lean()).assignedStaffId).toBeNull();
  });

  test('Order-item cancellation rolls back when its transaction-scoped audit fails', async () => {
    await Order.collection.insertOne({
      _id: orderId, shopId, status: 'NEW', salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US',
    });
    await OrderItem.collection.insertOne({
      _id: orderItemId, orderId, shopId, status: 'NEW',
      salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US',
    });

    await expect(orderItemCancelService.cancelOrderItem(String(orderItemId), {}, {
      accountId: String(actorId), permissions: ['ORDERS:WRITE'],
    })).rejects.toThrow('audit unavailable');

    expect((await OrderItem.findById(orderItemId).lean()).status).toBe('NEW');
  });

  test('Production assignment rolls back when its transaction-scoped audit fails', async () => {
    await ProductionTask.collection.insertOne({
      _id: taskId, orderId, orderItemId, shopId, status: 'NEED_SCALE', assignedDesignUserId: null,
    });
    hrPublic.listAssignableProfiles.mockResolvedValue([{ accountId: assigneeId }]);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId: assigneeId, team: { code: 'DESIGN' },
    }]);
    orderPublic.findItemById.mockResolvedValue({ _id: orderItemId, orderId, shopId });

    await expect(productionTaskService.assignDesignTask(String(taskId), {
      assignedDesignUserId: String(assigneeId),
    }, { accountId: String(actorId), permissions: ['PRODUCTION:WRITE'] })).rejects.toThrow('audit unavailable');

    expect((await ProductionTask.findById(taskId).lean()).assignedDesignUserId).toBeNull();
  });
});
