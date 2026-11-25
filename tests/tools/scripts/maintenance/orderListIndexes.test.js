const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { indexes, applyBatch, matches } = require('../../../../tools/scripts/maintenance/applyOrderListIndexes');

describe('additive order list index batch', () => {
  let mongo;
  let db;
  const output = { write: jest.fn() };
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'lng_web_be_develop', autoIndex: false, autoCreate: false });
    db = mongoose.connection.db;
    for (const name of new Set(indexes.map((i) => i.collection))) await db.createCollection(name);
    for (const name of ['productiontasks', 'shipments', 'financesnapshots', 'vendorsubmissions']) {
      await db.collection(name).insertMany(Array.from({ length: 120 }, (_, n) => ({ updatedAt: new Date(n * 1000), calculatedAt: new Date(n * 1000), status: 'SUBMITTED' })));
    }
  }, 120000);
  afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

  test('refuses a different database before any write', async () => {
    await expect(applyBatch(db, { database: 'lng_web_be', apply: true, output })).rejects.toThrow('database');
    expect(await db.collection('productiontasks').indexes()).toHaveLength(1);
  });
  test('dry-run creates nothing and returns no rollback commands', async () => {
    const rows = await applyBatch(db, { database: db.databaseName, output });
    expect(rows.every((r) => r.status === 'PLANNED' && !r.rollback)).toBe(true);
    expect(await db.collection('productiontasks').indexes()).toHaveLength(1);
  });
  test('preflights the entire batch before creating any index', async () => {
    const last = indexes.at(-1);
    await db.collection(last.collection).createIndex({ wrongField: 1 }, { name: last.name });
    await expect(applyBatch(db, { database: db.databaseName, apply: true, output })).rejects.toThrow('definition conflict');
    expect(await db.collection('productiontasks').indexes()).toHaveLength(1);
    await db.collection(last.collection).dropIndex(last.name);
  });
  test('preflights missing and null values as duplicates for the unique orderId index', async () => {
    const collection = db.collection('fulfillmentsideeffectrequests');
    await collection.insertMany([{}, { orderId: null }]);
    await expect(applyBatch(db, { database: db.databaseName, apply: true, output })).rejects.toThrow('Duplicate data');
    expect(await db.collection('productiontasks').indexes()).toHaveLength(1);
    await collection.deleteMany({});
  });
  test('creates only missing definitions, is idempotent, and removes blocking sorts from global lists', async () => {
    const first = await applyBatch(db, { database: db.databaseName, apply: true, output });
    expect(first.filter((r) => r.status === 'CREATED')).toHaveLength(8);
    expect(first.every((r) => r.rollback?.includes('dropIndex'))).toBe(true);
    expect(first.every((r) => r.rollback?.includes('getSiblingDB("lng_web_be_develop")'))).toBe(true);
    const second = await applyBatch(db, { database: db.databaseName, apply: true, output });
    expect(second.every((r) => r.status === 'EXISTS' && !r.rollback)).toBe(true);
    for (const index of indexes.slice(0, 4)) {
      const e = await db.collection(index.collection).find(index.collection === 'vendorsubmissions' ? { status: { $ne: 'CANCELLED' } } : {}).sort(index.key).limit(50).explain('executionStats');
      expect(JSON.stringify(e.queryPlanner.winningPlan)).not.toMatch(/"stage":"(?:COLLSCAN|SORT)"/);
      expect(e.executionStats.totalDocsExamined).toBe(50);
    }
  });
  test('compares compound key order and correctness options', () => {
    expect(matches({ key: { a: 1, b: -1 } }, { key: { b: -1, a: 1 } })).toBe(false);
    expect(matches({ key: { a: 1 }, unique: true }, { key: { a: 1 } })).toBe(false);
  });
  test('batch definitions agree with model schemas', () => {
    const models = [
      require('../../../../src/modules/production/models/productionTask.model'),
      require('../../../../src/modules/shipment/models/shipment.model'),
      require('../../../../src/modules/finance/models/financeSnapshot.model'),
      require('../../../../src/modules/vendorSubmission/models/vendorSubmission.model'),
      require('../../../../src/modules/finance/models/financeRecalculationRequest.model'),
      require('../../../../src/modules/mapping/models/fulfillmentSideEffectRequest.model'),
      require('../../../../src/modules/finance/models/refundRecord.model'),
    ];
    for (const index of indexes) {
      const model = models.find((m) => m.collection.name === index.collection);
      expect(model.schema.indexes().some(([key, options]) => matches({ key, ...options }, index))).toBe(true);
    }
  });
});
