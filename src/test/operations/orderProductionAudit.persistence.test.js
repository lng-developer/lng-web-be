const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../modules/auth/public', () => ({ canAccessScope: jest.fn(() => true) }));
jest.mock('../../modules/hr/public', () => ({ listAssignableProfiles: jest.fn() }));
jest.mock('../../modules/organization/public', () => ({ listAccountOrganizationSummaries: jest.fn() }));
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
const ProductionTask = require('../../modules/production/models/productionTask.model');
const orderAssignmentService = require('../../modules/order/services/orderAssignment.service');
const productionTaskService = require('../../modules/production/services/productionTask.service');

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
    await Promise.all([Order.deleteMany({}), ProductionTask.deleteMany({})]);
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));
  });

  test('Order assignment rolls back when its transaction-scoped audit fails', async () => {
    await Order.collection.insertOne({ _id: orderId, shopId, assignedStaffId: null });

    await expect(orderAssignmentService.assignStaff(String(orderId), String(assigneeId), {
      accountId: String(actorId), permissions: ['ORDERS:WRITE'],
    })).rejects.toThrow('audit unavailable');

    expect((await Order.findById(orderId).lean()).assignedStaffId).toBeNull();
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
