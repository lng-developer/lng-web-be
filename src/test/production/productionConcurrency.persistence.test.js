const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../modules/media/public', () => ({ assertMediaAssetExists: jest.fn() }));
jest.mock('../../modules/mapping/public', () => ({ getFulfillmentPlanForOrderItem: jest.fn() }));
jest.mock('../../modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(), getListingById: jest.fn(), getListingPsdReadiness: jest.fn(),
}));
jest.mock('../../modules/customization/public', () => ({
  getOrderItemCustomizationView: jest.fn(), listOrderItemCustomizationViews: jest.fn(),
}));
jest.mock('../../modules/shop/public', () => ({ findById: jest.fn() }));
jest.mock('../../modules/hr/public', () => ({
  listEmployeeProfilesByAccountIds: jest.fn(), listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));
jest.mock('../../modules/organization/public', () => ({ listAccountOrganizationSummaries: jest.fn() }));
jest.mock('../../modules/vendorSubmission/public', () => ({ listLatestByProductionTaskIds: jest.fn() }));
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
const mappingPublic = require('../../modules/mapping/public');
const catalogPublic = require('../../modules/catalog/public');
const customizationPublic = require('../../modules/customization/public');
const shopPublic = require('../../modules/shop/public');
const hrPublic = require('../../modules/hr/public');
const organizationPublic = require('../../modules/organization/public');
const vendorSubmissionPublic = require('../../modules/vendorSubmission/public');
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
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValue([]);
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValue([]);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([]);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([]);
    vendorSubmissionPublic.listLatestByProductionTaskIds.mockResolvedValue([]);
  });

  function mockRecheckInputs({ orderId, orderItemId, shopId, inputAssetId }) {
    orderPublic.findItemById.mockResolvedValue({
      _id: orderItemId, orderId, shopId, quantity: 1, status: 'NEED_PRODUCTION',
    });
    orderPublic.findById.mockResolvedValue({ _id: orderId, shopId, addressValidationStatus: 'VALID' });
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      id: String(new mongoose.Types.ObjectId()),
      status: 'READY',
      listing: { id: String(new mongoose.Types.ObjectId()) },
      internalTemplate: { id: String(new mongoose.Types.ObjectId()) },
      vendorProduct: null,
      vendorCostCenter: null,
    });
    catalogPublic.getListingById.mockResolvedValue({
      id: mappingPublic.getFulfillmentPlanForOrderItem.mock.results[0]?.value?.listing?.id,
      psdTemplateAssetId: String(new mongoose.Types.ObjectId()),
    });
    catalogPublic.getListingPsdReadiness.mockResolvedValue({ ready: true });
    catalogPublic.getInternalTemplateById.mockResolvedValue({
      id: String(new mongoose.Types.ObjectId()),
      artworkSlots: [{ key: 'FRONT', label: 'Front', required: true }],
      designAssets: [],
    });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue({
      imageAssets: [{ assetId: inputAssetId }],
    });
    shopPublic.findById.mockResolvedValue({ _id: shopId, name: 'Shop' });
  }

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

  test('service recheck clears derived blockers and preserves operator file state', async () => {
    const taskId = new mongoose.Types.ObjectId();
    const orderId = new mongoose.Types.ObjectId();
    const orderItemId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId();
    const fileCheckId = new mongoose.Types.ObjectId();
    const inputAssetId = new mongoose.Types.ObjectId();
    const outputAssetId = new mongoose.Types.ObjectId();
    const assigneeId = new mongoose.Types.ObjectId();
    await ProductionTask.collection.insertOne({
      _id: taskId, orderId, orderItemId, shopId, fulfillmentPlanId: new mongoose.Types.ObjectId(),
      status: 'BLOCKED', scaleStatus: 'NEED_SCALE', qcStatus: 'NOT_READY', blockers: ['PSD_MISSING'],
      assignedDesignUserId: assigneeId, designNote: 'operator note',
      fileChecks: [{
        _id: fileCheckId, slotKey: 'FRONT', slotLabel: 'Old label', required: true,
        sourceType: 'CUSTOMER_IMAGE', inputAssetId, outputAssetId,
        scaleStatus: 'SCALED', qcStatus: 'PENDING', blockers: [], note: 'check note',
      }],
    });
    mockRecheckInputs({ orderId, orderItemId, shopId, inputAssetId });

    await service.createOrRecheckTaskForOrderItem(String(orderItemId), {
      permissions: ['PRODUCTION:WRITE'], auditContext: {},
    });

    const stored = await ProductionTask.findById(taskId).lean();
    expect(stored).toMatchObject({
      status: 'QC_PENDING', blockers: [], assignedDesignUserId: assigneeId, designNote: 'operator note',
    });
    const front = stored.fileChecks.find((check) => check.slotKey === 'FRONT');
    expect(front).toMatchObject({
      _id: fileCheckId, slotLabel: 'Front', outputAssetId, qcStatus: 'PENDING', note: 'check note',
    });
  });

  test('recheck retries from current state instead of overwriting a concurrent operator note', async () => {
    const taskId = new mongoose.Types.ObjectId();
    const orderId = new mongoose.Types.ObjectId();
    const orderItemId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId();
    const inputAssetId = new mongoose.Types.ObjectId();
    await ProductionTask.create({
      _id: taskId, orderId, orderItemId, shopId, fulfillmentPlanId: new mongoose.Types.ObjectId(),
      status: 'BLOCKED', scaleStatus: 'NEED_SCALE', qcStatus: 'NOT_READY', blockers: ['PSD_MISSING'],
      designNote: 'old note',
      fileChecks: [{
        slotKey: 'FRONT', required: true, sourceType: 'CUSTOMER_IMAGE', inputAssetId,
        scaleStatus: 'NEED_SCALE', qcStatus: 'NOT_READY', blockers: ['SCALED_OUTPUT_MISSING'],
      }],
    });
    mockRecheckInputs({ orderId, orderItemId, shopId, inputAssetId });
    const originalFind = repository.findByOrderItem;
    let releaseRead;
    let markRead;
    const read = new Promise((resolve) => { markRead = resolve; });
    const release = new Promise((resolve) => { releaseRead = resolve; });
    let paused = false;
    const findSpy = jest.spyOn(repository, 'findByOrderItem').mockImplementation(async (id, options) => {
      const current = await originalFind(id, options);
      if (options?.session && !paused) {
        paused = true;
        markRead();
        await release;
      }
      return current;
    });

    const recheck = service.createOrRecheckTaskForOrderItem(String(orderItemId), {
      permissions: ['PRODUCTION:WRITE'], auditContext: {},
    });
    await read;
    await ProductionTask.updateOne({ _id: taskId }, { $set: { designNote: 'concurrent note' } });
    releaseRead();
    await recheck;
    findSpy.mockRestore();

    const stored = await ProductionTask.findById(taskId).lean();
    expect(stored).toMatchObject({ designNote: 'concurrent note', status: 'NEED_SCALE' });
    expect(stored.blockers).toEqual(['SCALED_OUTPUT_MISSING']);
    expect(auditPublic.record).toHaveBeenCalledTimes(1);
  }, 30000);
});
