const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ProductionTask = require('../../../src/modules/production/models/productionTask.model');
const DesignTask = require('../../../src/modules/design/models/designTask.model');
const production = require('../../../src/modules/production/repositories/productionTask.repository');
const design = require('../../../src/modules/design/repositories/designTask.repository');

let server;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false, autoCreate: false });
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });

test('production urgency orders the entire queue before page boundaries and ignores recent edits', async () => {
  const row = (name, due, ordered, status = 'NEED_SCALE') => ({ _id: new mongoose.Types.ObjectId(), designNote: name, orderItemSnapshot: { externalOrderId: name }, status,
    createdAt: new Date('2026-11-25'), updatedAt: new Date('2026-11-25'),
    orderSnapshot: { shipByDate: due ? new Date(due) : null, orderedAt: new Date(ordered) } });
  await ProductionTask.collection.insertMany([
    row('no deadline', null, '2026-11-01'),
    row('later', '2026-11-28', '2026-11-01'),
    row('same deadline newer order', '2026-11-24', '2026-11-20'),
    row('same deadline older order', '2026-11-24', '2026-11-10'),
    row('oldest overdue', '2026-11-21', '2026-11-15'),
    row('completed', '2026-11-01', '2026-11-01', 'SENT_TO_VENDOR'),
  ]);
  const first = await production.list({ sort: 'urgency', page: 1, limit: 2 });
  const second = await production.list({ sort: 'urgency', page: 2, limit: 2 });
  const third = await production.list({ sort: 'urgency', page: 3, limit: 2 });
  expect([...first.items, ...second.items, ...third.items].map(x => x.designNote)).toEqual([
    'oldest overdue', 'same deadline older order', 'same deadline newer order', 'later', 'no deadline', 'completed',
  ]);
  expect(first.total).toBe(6);
  await ProductionTask.collection.insertOne(row('blocked', '2026-11-01', '2026-11-01', 'BLOCKED'));
  const counts = await production.summarizeQueueCounts({});
  expect(counts.unassigned).toBe(5);
  expect(counts.blocked).toBe(1);
});

test('design ranks urgency explicitly and keeps older pending work ahead of recently edited work', async () => {
  await DesignTask.collection.insertMany([
    { brief: 'normal', priority: 'NORMAL', status: 'REQUESTED', createdAt: new Date('2026-11-01') },
    { brief: 'urgent newer', priority: 'URGENT', status: 'REQUESTED', createdAt: new Date('2026-11-20') },
    { brief: 'urgent older', priority: 'URGENT', status: 'IN_PROGRESS', createdAt: new Date('2026-11-10'), updatedAt: new Date('2026-11-25') },
    { brief: 'high', priority: 'HIGH', status: 'ASSIGNED', createdAt: new Date('2026-11-02') },
    { brief: 'completed', priority: 'URGENT', status: 'APPROVED', createdAt: new Date('2026-11-01') },
  ]);
  const result = await design.list({ sortBy: 'urgency', page: 1, limit: 10 });
  expect(result.items.map(x => x.brief)).toEqual(['urgent older', 'urgent newer', 'high', 'normal', 'completed']);
});
