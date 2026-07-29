const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../modules/auth/public', () => ({ canAccessScope: jest.fn(() => true) }));
jest.mock('../../modules/production/public', () => ({ syncOrderAddressSnapshot: jest.fn() }));
jest.mock('../../shared/clients/smartyClient', () => ({ validateUsStreetAddress: jest.fn() }));

const auditPublic = require('../../modules/audit/public');
const smartyClient = require('../../shared/clients/smartyClient');
const productionPublic = require('../../modules/production/public');
const Order = require('../../modules/order/models/order.model');
const OrderCase = require('../../modules/order/models/orderCase.model');
const OrderTimeline = require('../../modules/order/models/orderTimeline.model');
const orderRepository = require('../../modules/order/repositories/order.repository');
const orderCaseRepository = require('../../modules/order/repositories/orderCase.repository');
const addressService = require('../../modules/order/services/orderAddressValidation.service');
const caseService = require('../../modules/order/services/orderCase.service');

function releaseAfterTwoReads(repository, method) {
  const original = repository[method].bind(repository);
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return jest.spyOn(repository, method).mockImplementation(async (...args) => {
    const result = await original(...args);
    reads += 1;
    if (reads === 2) release();
    await gate;
    return result;
  });
}

describe('Order address and case concurrency persistence', () => {
  let database;
  let orderId;
  let caseId;
  let shopId;
  let actorId;

  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    await Promise.all([Order.deleteMany({}), OrderCase.deleteMany({}), OrderTimeline.deleteMany({})]);
    orderId = new mongoose.Types.ObjectId();
    caseId = new mongoose.Types.ObjectId();
    shopId = new mongoose.Types.ObjectId();
    actorId = new mongoose.Types.ObjectId();
    await Order.collection.insertOne({
      _id: orderId,
      shopId,
      caseStatus: 'OPEN',
      shippingAddress: {
        addressLine1: '1 Main St', city: 'Dallas', postalCode: '75001', countryCode: 'US',
      },
      addressValidationStatus: 'NOT_CHECKED',
      externalData: {},
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    });
    auditPublic.record.mockResolvedValue({ id: 'audit-1' });
    productionPublic.syncOrderAddressSnapshot.mockResolvedValue(null);
  });

  test('manual address update rolls back its Order row and timeline when audit fails', async () => {
    auditPublic.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(addressService.updateShippingAddress(String(orderId), { city: 'Austin' }, {
      accountId: String(actorId), permissions: ['ORDERS:WRITE'], auditContext: {},
    })).rejects.toThrow('audit unavailable');

    expect((await Order.findById(orderId).lean()).shippingAddress.city).toBe('Dallas');
    expect(await OrderTimeline.countDocuments({ orderId })).toBe(0);
    expect(productionPublic.syncOrderAddressSnapshot).not.toHaveBeenCalled();
  });

  test('normalized validation rolls back its Order row and timeline when audit fails', async () => {
    smartyClient.validateUsStreetAddress.mockResolvedValue([{
      delivery_line_1: '1 Main Street',
      components: { city_name: 'Dallas', state_abbreviation: 'TX', zipcode: '75001' },
      analysis: { enhanced_match: 'postal-match' },
    }]);
    auditPublic.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(addressService.validateAddress(String(orderId))).rejects.toThrow('audit unavailable');

    const persisted = await Order.findById(orderId).lean();
    expect(persisted.addressValidationStatus).toBe('NOT_CHECKED');
    expect(persisted.shippingAddress.addressLine1).toBe('1 Main St');
    expect(await OrderTimeline.countDocuments({ orderId })).toBe(0);
    expect(productionPublic.syncOrderAddressSnapshot).not.toHaveBeenCalled();
  });

  test('concurrent partial address merges allow one writer without overwriting it', async () => {
    const readBarrier = releaseAfterTwoReads(orderRepository, 'findById');

    const results = await Promise.allSettled([
      addressService.updateShippingAddress(String(orderId), { city: 'Austin' }),
      addressService.updateShippingAddress(String(orderId), { postalCode: '78701' }),
    ]);
    readBarrier.mockRestore();

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')[0].reason).toMatchObject({ statusCode: 409 });
    const persisted = await Order.findById(orderId).lean();
    expect([
      persisted.shippingAddress.city === 'Austin',
      persisted.shippingAddress.postalCode === '78701',
    ].filter(Boolean)).toHaveLength(1);
    expect(await OrderTimeline.countDocuments({ orderId })).toBe(1);
    expect(auditPublic.record).toHaveBeenCalledTimes(1);
  });

  test('concurrent resolve and cancel allow one OPEN transition and one evidence set', async () => {
    await OrderCase.collection.insertOne({
      _id: caseId,
      orderId,
      shopId,
      status: 'OPEN',
      caseType: 'OTHER',
      severity: 'MEDIUM',
      title: 'Concurrent case',
      comments: [],
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    });
    const readBarrier = releaseAfterTwoReads(orderCaseRepository, 'findById');
    const auth = { accountId: String(actorId), permissions: ['ORDERS:WRITE'], auditContext: {} };

    const results = await Promise.allSettled([
      caseService.resolveOrderCase(String(caseId), { resolutionNote: 'Done' }, auth),
      caseService.cancelOrderCase(String(caseId), { cancelReason: 'Duplicate' }, auth),
    ]);
    readBarrier.mockRestore();

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')[0].reason).toMatchObject({ statusCode: 409 });
    expect(['RESOLVED', 'CANCELLED']).toContain((await OrderCase.findById(caseId).lean()).status);
    expect(await OrderTimeline.countDocuments({ orderId })).toBe(1);
    expect(auditPublic.record).toHaveBeenCalledTimes(1);
  });
});
