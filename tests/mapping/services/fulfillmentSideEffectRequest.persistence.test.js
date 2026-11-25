const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const repository = require('../../../src/modules/mapping/repositories/fulfillmentSideEffectRequest.repository');
const Model = require('../../../src/modules/mapping/models/fulfillmentSideEffectRequest.model');
let mongo;
const orderId = new mongoose.Types.ObjectId().toString();
const itemA = new mongoose.Types.ObjectId().toString();
const itemB = new mongoose.Types.ObjectId().toString();
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'mapping_side_effect_test' });
  await Model.init();
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Model.deleteMany({}); });

test('coalesces items by order and retains an update arriving during execution', async () => {
  await repository.request({ orderId, orderItemId: itemA, markReady: true });
  await repository.request({ orderId, orderItemId: itemB, triggerProduction: true });
  const run = await repository.claim(orderId, 'first', 60000);
  expect(Object.keys(run.items)).toHaveLength(2);
  await repository.request({ orderId, orderItemId: itemA, triggerProduction: true });
  await repository.complete(orderId, 'first', run.requestedVersion);
  const next = await repository.claim(orderId, 'second', 60000);
  expect(next).not.toBeNull();
  expect(next.items[itemA]).toMatchObject({ markReady: false, triggerProduction: true });
  await repository.complete(orderId, 'second', next.requestedVersion);
  expect(await repository.listDue()).toHaveLength(0);
});

test('a ready-to-blocked change clears stale effects without dropping a sibling request', async () => {
  await repository.request({ orderId, orderItemId: itemA, markReady: true, triggerProduction: true });
  await repository.request({ orderId, orderItemId: itemB, markReady: true, triggerProduction: true });
  await repository.request({ orderId, orderItemId: itemA });
  const run = await repository.claim(orderId, 'owner', 60000);
  expect(run.items[itemA]).toMatchObject({ markReady: false, triggerProduction: false });
  expect(run.items[itemB]).toMatchObject({ markReady: true, triggerProduction: true });
});

test('one owner per order and expired owner cannot acknowledge newer work', async () => {
  await repository.request({ orderId, orderItemId: itemA });
  const run = await repository.claim(orderId, 'old', 60000);
  expect(await repository.claim(orderId, 'other', 60000)).toBeNull();
  await Model.updateOne({ orderId }, { $set: { leaseExpiresAt: new Date(0) } });
  expect(await repository.claim(orderId, 'new', 60000)).not.toBeNull();
  expect(await repository.complete(orderId, 'old', run.requestedVersion)).toBe(false);
  expect(await repository.renew(orderId, 'old', 60000)).toBe(false);
});

test('retry failures remain durable and stop after three attempts until a new request', async () => {
  await repository.request({ orderId, orderItemId: itemA });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const run = await repository.claim(orderId, 'owner', 60000);
    await repository.fail(orderId, 'owner', run.requestedVersion, 'VALIDATION_ERROR', new Date(0));
  }
  expect(await repository.listDue()).toHaveLength(0);
  expect((await Model.findOne({ orderId }).lean()).lastErrorCode).toBe('VALIDATION_ERROR');
  await repository.request({ orderId, orderItemId: itemA });
  expect(await repository.listDue()).toHaveLength(1);
});
