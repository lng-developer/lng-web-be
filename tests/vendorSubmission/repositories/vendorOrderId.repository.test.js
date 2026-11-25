const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const repository = require('../../../src/modules/vendorSubmission/repositories/vendorOrderId.repository');
const VendorSubmission = require('../../../src/modules/vendorSubmission/models/vendorSubmission.model');

describe('vendor order sequence Mongo concurrency', () => {
  let mongo;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'vendor_sequence_test' });
  }, 120000);
  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });
  test('concurrent first reservations are unique and never reset to an older history floor', async () => {
    const scope = ['MANGOTEE', 'vendor-a', 'order-1'];
    const values = await Promise.all(Array.from({ length: 12 }, () => repository.nextSequence(scope, 2)));
    expect(values.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 3));
    expect(await repository.nextSequence(scope, 0)).toBe(15);
    expect(await repository.nextSequence(['PRINTWAY', 'vendor-a', 'order-1'], 0)).toBe(1);
    expect(await repository.nextSequence(['MANGOTEE', 'vendor-b', 'order-1'], 0)).toBe(1);
  });
  test('history includes cancelled submissions but excludes another vendor or provider', async () => {
    const orderId = new mongoose.Types.ObjectId();
    await VendorSubmission.collection.insertMany([
      { orderId, provider: 'MANGOTEE', status: 'CANCELLED', payloadSnapshot: { vendorProduct: { vendor: { id: 'vendor-a' } } }, vendorExternalOrderId: 'old' },
      { orderId, provider: 'MANGOTEE', payloadSnapshot: { vendorProduct: { vendor: { id: 'vendor-b' } } } },
      { orderId, provider: 'PRINTWAY', payloadSnapshot: { vendorProduct: { vendor: { id: 'vendor-a' } } } },
    ]);
    const rows = await repository.listHistory(orderId, 'MANGOTEE', 'vendor-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorExternalOrderId).toBe('old');
  });
});
