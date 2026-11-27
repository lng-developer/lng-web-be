const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
jest.mock('../../src/modules/auth/public', () => ({ canAccessScope: jest.fn(() => true) }));
jest.mock('../../src/modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../src/modules/mapping/public', () => ({ syncOrderItemQuantity: jest.fn() }));
jest.mock('../../src/modules/finance/public', () => ({ recalculateOrder: jest.fn() }));
jest.mock('../../src/modules/vendorSubmission/public', () => ({ getByOrderItemId: jest.fn() }));

const Order = require('../../src/modules/order/models/order.model');
const Item = require('../../src/modules/order/models/orderItem.model');
const Task = require('../../src/modules/production/models/productionTask.model');
const Projection = require('../../src/modules/order/models/orderWorkbenchProjection.model');
const Timeline = require('../../src/modules/order/models/orderTimeline.model');
const audit = require('../../src/modules/audit/public');
const repository = require('../../src/modules/order/repositories/orderItem.repository');
const service = require('../../src/modules/order/services/orderItemQuantity.service');

describe('quantity editing persistence', () => {
  let database;
  const orderId = new mongoose.Types.ObjectId();
  const itemId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const shopId = new mongoose.Types.ObjectId();
  const body = { quantity: 2, expectedQuantity: 1, reason: 'Pack 2' };
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri());
    await Promise.all([Order.init(), Item.init(), Task.init(), Projection.init(), Timeline.init()]);
  });
  afterAll(async () => { await mongoose.disconnect(); await database.stop(); });
  beforeEach(async () => {
    jest.resetAllMocks();
    require('../../src/modules/auth/public').canAccessScope.mockReturnValue(true);
    await Promise.all([Order.deleteMany({}), Item.deleteMany({}), Task.deleteMany({}), Projection.deleteMany({}), Timeline.deleteMany({})]);
    await Order.collection.insertOne({ _id: orderId, shopId, status: 'PROCESSING' });
    await Item.collection.insertOne({ _id: itemId, orderId, shopId, quantity: 1, status: 'NEED_PRODUCTION', updatedAt: new Date(), price: { itemPriceAmount: 2500 } });
    await Task.collection.insertOne({ _id: taskId, orderId, orderItemId: itemId, shopId, status: 'NEED_SCALE', fulfillQty: 1, orderItemSnapshot: { quantity: 1 }, updatedAt: new Date() });
    await Projection.collection.insertOne({ orderId, items: [{ orderItemId: itemId, item: { quantity: 1 } }] });
  });
  test('changes live quantities together and preserves override across reimport', async () => {
    await service.updateQuantity(String(itemId), body, { permissions: ['ORDERS:WRITE'] });
    expect((await Item.findById(itemId).lean())).toMatchObject({ quantity: 2, quantityOverride: 2, price: { itemPriceAmount: 2500 } });
    expect((await Task.findById(taskId).lean())).toMatchObject({ fulfillQty: 2, status: 'NEED_SCALE', orderItemSnapshot: { quantity: 2 } });
    expect((await Projection.findOne({ orderId }).lean()).items[0].item.quantity).toBe(2);
    await repository.updateFromExternalImport(itemId, { set: { quantity: 1, title: 'Reimported title' } });
    expect(await Item.findById(itemId).lean()).toMatchObject({ quantity: 2, title: 'Reimported title' });
    expect(await Timeline.countDocuments({ orderItemId: itemId, eventType: 'ORDER_ITEM_QUANTITY_UPDATED' })).toBe(1);
  });
  test('normal marketplace imports still update quantity', async () => {
    await repository.updateFromExternalImport(itemId, { set: { quantity: 3 } });
    expect((await Item.findById(itemId).lean()).quantity).toBe(3);
  });
  test('audit failure rolls back order, production and projection', async () => {
    audit.record.mockRejectedValue(new Error('audit unavailable'));
    await expect(service.updateQuantity(String(itemId), body, { permissions: ['ORDERS:WRITE'] })).rejects.toThrow('audit unavailable');
    expect((await Item.findById(itemId).lean()).quantity).toBe(1);
    expect((await Task.findById(taskId).lean()).fulfillQty).toBe(1);
    expect((await Projection.findOne({ orderId }).lean()).items[0].item.quantity).toBe(1);
    expect(await Timeline.countDocuments({ orderItemId: itemId })).toBe(0);
  });
});
