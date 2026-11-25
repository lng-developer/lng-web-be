const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const shipments = require('../../src/modules/shipment/repositories/shipment.repository');
const polls = require('../../src/modules/shipment/repositories/vendorTrackingPoll.repository');

jest.setTimeout(120000);
let db;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });

test('duplicate discovery, competing workers and expired leases converge across restart', async () => {
  const id = new mongoose.Types.ObjectId();
  const now = new Date();
  await polls.discover([id], now);
  await polls.discover([id], now);
  const [a, b] = await Promise.all(['first', 'other'].map(token => polls.claim(id, token, now)));
  expect([a,b].filter(Boolean)).toHaveLength(1);
  const winner = a || b;
  const later = new Date(winner.leaseExpiresAt.getTime() + 1);
  await mongoose.disconnect();
  await mongoose.connect(db.getUri());
  expect(await polls.remember(id, winner.leaseToken, { trackingNumber: 'survives-restart' })).toBe(true);
  const recovered = await polls.claim(id, 'recovered', later);
  expect(recovered.pendingUpdate.trackingNumber).toBe('survives-restart');
  expect(await polls.finish(id, winner.leaseToken, 'STALE', null, later)).toBe(false);
  expect(await polls.finish(id, 'recovered', 'TRACKED', null, later)).toBe(true);
  expect(await polls.due(10,later)).toEqual([]);
});

test('a paused application cannot overwrite the replacement worker or commit a partial shipment write', async () => {
  const id = new mongoose.Types.ObjectId();
  const now = new Date();
  await polls.discover([id], now);
  const original = await polls.claim(id, 'slow', now);
  const record = await shipments.create({
    vendorSubmissionId: id, orderId: new mongoose.Types.ObjectId(),
    orderItemId: new mongoose.Types.ObjectId(), shopId: new mongoose.Types.ObjectId(),
  });
  let resume;
  const paused = new Promise(resolve => { resume = resolve; });
  const stale = paused.then(() => polls.withOwnedWrite(id, 'slow', session =>
    shipments.updateTrackingIfNotDelivered(record._id, { trackingNumber: 'obsolete' }, session)));
  await polls.claim(id, 'new', new Date(original.leaseExpiresAt.getTime() + 1));
  await polls.withOwnedWrite(id, 'new', session =>
    shipments.updateTrackingIfNotDelivered(record._id, { trackingNumber: 'current' }, session));
  resume();
  await expect(stale).rejects.toMatchObject({ code: 'TRACKING_LEASE_LOST' });
  await expect(polls.withOwnedWrite(id, 'new', async session => {
    await shipments.updateTrackingIfNotDelivered(record._id, { trackingNumber: 'rolled-back' }, session);
    throw new Error('interrupt transaction');
  })).rejects.toThrow('interrupt transaction');
  expect((await shipments.findById(record._id)).trackingNumber).toBe('current');
});
