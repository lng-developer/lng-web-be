const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../modules/media/public', () => ({ assertMediaAssetExists: jest.fn() }));
jest.mock('../../modules/order/public', () => ({
  addressValidationStatuses: { VALID: 'VALID', OVERRIDDEN: 'OVERRIDDEN' },
  appendTimeline: jest.fn(),
  deriveOrderItemWorkflow: jest.requireActual('../../modules/order/services/orderWorkflow.service').deriveOrderItemWorkflow,
  findById: jest.fn(),
  findItemById: jest.fn(),
  transitionItemStatus: jest.fn(),
}));

const auditPublic = require('../../modules/audit/public');
const mediaPublic = require('../../modules/media/public');
const orderPublic = require('../../modules/order/public');
const ProductionTask = require('../../modules/production/models/productionTask.model');
const repository = require('../../modules/production/repositories/productionTask.repository');
const service = require('../../modules/production/services/productionTask.service');

describe('Production concurrent mutation persistence', () => {
  let database;

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
    await ProductionTask.deleteMany({});
    auditPublic.record.mockResolvedValue({});
    mediaPublic.assertMediaAssetExists.mockResolvedValue({});
    orderPublic.appendTimeline.mockResolvedValue({});
    orderPublic.transitionItemStatus.mockResolvedValue({});
  });

  test('recheck updates snapshots without replacing operational state', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const orderItemId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId();
    const fulfillmentPlanId = new mongoose.Types.ObjectId();
    const assigneeId = new mongoose.Types.ObjectId();
    const outputAssetId = new mongoose.Types.ObjectId();
    const initial = await repository.upsertByOrderItemWithResult(
      orderItemId,
      { orderId, shopId, fulfillmentPlanId, orderSnapshot: { status: 'PROCESSING' } },
      {
        setOnInsert: {
          status: 'QC_PENDING',
          scaleStatus: 'SCALED',
          qcStatus: 'PENDING',
          assignedDesignUserId: assigneeId,
          designNote: 'operator note',
          fileChecks: [{
            slotKey: 'FRONT', sourceType: 'CUSTOMER_IMAGE', outputAssetId,
            scaleStatus: 'SCALED', qcStatus: 'PENDING',
          }],
        },
      },
    );
    const rechecked = await repository.upsertByOrderItemWithResult(
      orderItemId,
      { orderId, shopId, fulfillmentPlanId, orderSnapshot: { status: 'ON_HOLD' } },
      {
        setOnInsert: {
          status: 'NEED_SCALE', assignedDesignUserId: null, designNote: null, fileChecks: [],
        },
      },
    );

    expect(initial.created).toBe(true);
    expect(rechecked.created).toBe(false);
    expect(rechecked.task).toMatchObject({
      status: 'QC_PENDING', assignedDesignUserId: assigneeId, designNote: 'operator note',
      orderSnapshot: { status: 'ON_HOLD' },
    });
    expect(rechecked.task.fileChecks[0].outputAssetId).toEqual(outputAssetId);
  });

  test('same-status scaled writers retain one winner and emit no loser audit', async () => {
    const taskId = new mongoose.Types.ObjectId();
    const orderId = new mongoose.Types.ObjectId();
    const orderItemId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId();
    const fileCheckId = new mongoose.Types.ObjectId();
    const outputIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await ProductionTask.collection.insertOne({
      _id: taskId,
      orderId,
      orderItemId,
      shopId,
      fulfillmentPlanId: new mongoose.Types.ObjectId(),
      status: 'QC_PENDING',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'PENDING',
      blockers: ['SCALED_OUTPUT_MISSING'],
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        required: true,
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: new mongoose.Types.ObjectId(),
        outputAssetId: null,
        scaleStatus: 'NEED_SCALE',
        qcStatus: 'PENDING',
        blockers: ['SCALED_OUTPUT_MISSING'],
      }],
    });
    orderPublic.findById.mockResolvedValue({ _id: orderId, shopId, addressValidationStatus: 'VALID' });
    orderPublic.findItemById.mockResolvedValue({ _id: orderItemId, orderId, shopId });
    const authContext = {
      accountId: String(new mongoose.Types.ObjectId()),
      permissions: ['PRODUCTION:WRITE'],
      auditContext: {},
    };

    const results = await Promise.allSettled(outputIds.map((outputId) => (
      service.uploadScaledFile(String(taskId), String(fileCheckId), String(outputId), authContext)
    )));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ statusCode: 409 }) }),
    ]);
    const stored = await ProductionTask.findById(taskId).lean();
    expect(outputIds).toContainEqual(stored.fileChecks[0].outputAssetId);
    expect(auditPublic.record).toHaveBeenCalledTimes(1);
  });
});
