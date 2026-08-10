const {
  classifyIndexes,
  collectMongoIndexAudit,
  hasCompatibleOptions,
  isLeftPrefix,
  sameKeyPattern,
} = require('../../../../tools/scripts/audit/mongoIndexAudit');

describe('mongoIndexAudit', () => {
  test('classifies compatible left-prefix indexes without crossing correctness options', () => {
    expect(isLeftPrefix(
      { key: { orderId: 1 } },
      { key: { orderId: 1, createdAt: 1, _id: 1 } },
    )).toBe(true);
    expect(isLeftPrefix(
      { key: { orderedAt: 1 } },
      { key: { orderedAt: -1, _id: -1 } },
    )).toBe(true);
    expect(hasCompatibleOptions({ unique: true }, { unique: false })).toBe(false);
    expect(hasCompatibleOptions(
      { partialFilterExpression: { status: 'ACTIVE' } },
      {},
    )).toBe(false);

    expect(classifyIndexes([
      { name: '_id_', key: { _id: 1 } },
      { name: 'orderId_1', key: { orderId: 1 } },
      { name: 'orderId_1_createdAt_1__id_1', key: { orderId: 1, createdAt: 1, _id: 1 } },
      { name: 'orderId_unique', key: { orderId: 1 }, unique: true },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        indexName: 'orderId_1',
        classification: 'COVERED',
        coveredBy: 'orderId_1_createdAt_1__id_1',
      }),
      expect.objectContaining({ indexName: 'orderId_unique', classification: 'KEEP' }),
    ]));
  });

  test('collects metadata with read-only database operations', async () => {
    const listIndexes = jest.fn().mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      { name: 'orderId_1', key: { orderId: 1 } },
    ]);
    const aggregate = jest.fn().mockResolvedValue([
      { name: 'orderId_1', accesses: { ops: 3, since: new Date('2026-08-02') } },
    ]);
    const collection = { listIndexes: () => ({ toArray: listIndexes }), aggregate: () => ({ toArray: aggregate }) };
    const db = {
      databaseName: 'lng_web_be',
      command: jest.fn(async (command) => (command.dbStats
        ? { dataSize: 10, storageSize: 20, indexSize: 30, collections: 1, indexes: 2 }
        : { count: 1, size: 10, storageSize: 20, totalIndexSize: 30, nindexes: 2 })),
      listCollections: jest.fn(() => ({ toArray: async () => [{ name: 'orders' }] })),
      collection: jest.fn(() => collection),
    };

    const report = await collectMongoIndexAudit(db, ['orders']);

    expect(report).toMatchObject({
      database: 'lng_web_be',
      totals: { dataBytes: 10, storageBytes: 20, indexBytes: 30, collections: 1, indexes: 2 },
      collections: [{ name: 'orders', indexCount: 2, usageAvailable: true }],
    });
    expect(db.command).toHaveBeenCalledWith({ dbStats: 1 });
    expect(db.command).toHaveBeenCalledWith({ collStats: 'orders' });
    expect(collection).not.toHaveProperty('dropIndex');
    expect(collection).not.toHaveProperty('createIndex');
  });

  test('keeps inventory available when index usage is unauthorized', async () => {
    const db = {
      databaseName: 'lng_web_be',
      command: jest.fn(async (command) => (command.dbStats
        ? { dataSize: 0, storageSize: 0, indexSize: 0, collections: 1, indexes: 1 }
        : { count: 0, size: 0, storageSize: 0, totalIndexSize: 0, nindexes: 1 })),
      listCollections: () => ({ toArray: async () => [{ name: 'orders' }] }),
      collection: () => ({
        listIndexes: () => ({ toArray: async () => [{ name: '_id_', key: { _id: 1 } }] }),
        aggregate: () => ({ toArray: async () => { throw new Error('not authorized'); } }),
      }),
    };

    const report = await collectMongoIndexAudit(db, ['orders']);

    expect(report.collections[0]).toMatchObject({ usageAvailable: false, indexes: [{ name: '_id_', operations: null }] });
  });
});

describe('auditMongoIndexes CLI', () => {
  test('connects, audits the batch-one collections, writes JSON, and disconnects', async () => {
    const { main } = require('../../../../tools/scripts/audit/auditMongoIndexes');
    const db = { databaseName: 'lng_web_be' };
    const output = { write: jest.fn() };
    const collectAudit = jest.fn().mockResolvedValue({ database: 'lng_web_be', collections: [] });
    const disconnectDatabase = jest.fn();

    await main({
      connectDatabase: jest.fn().mockResolvedValue(db),
      disconnectDatabase,
      collectAudit,
      output,
    });

    expect(collectAudit).toHaveBeenCalledWith(db, ['orders', 'orderitems', 'financesnapshots']);
    expect(JSON.parse(output.write.mock.calls[0][0])).toMatchObject({ database: 'lng_web_be' });
    expect(disconnectDatabase).toHaveBeenCalledTimes(1);
  });
});

describe('batch-one reduction manifest', () => {
  test('contains only compatible non-correctness left-prefix indexes', () => {
    const { batchOne } = require('../../../../tools/scripts/maintenance/mongoIndexReduction.batch1');

    expect(batchOne).toHaveLength(10);
    for (const entry of batchOne) {
      expect(entry).toEqual(expect.objectContaining({
        collection: expect.any(String),
        indexName: expect.any(String),
        classification: 'COVERED',
        coveredBy: expect.objectContaining({ name: expect.any(String), key: expect.any(Object) }),
        queryEvidence: expect.any(Array),
      }));
      expect(entry.originalDefinition.unique).not.toBe(true);
      expect(entry.originalDefinition.sparse).not.toBe(true);
      expect(entry.originalDefinition.expireAfterSeconds).toBeUndefined();
      expect(entry.originalDefinition.partialFilterExpression).toBeUndefined();
      expect(entry.originalDefinition.collation).toBeUndefined();
      expect(isLeftPrefix(entry.originalDefinition, entry.coveredBy)).toBe(true);
      expect(entry.queryEvidence.length).toBeGreaterThan(0);
    }
  });

  test('model schemas do not redeclare allowlisted indexes and retain unique indexes', () => {
    const { batchOne } = require('../../../../tools/scripts/maintenance/mongoIndexReduction.batch1');
    const models = {
      orders: require('../../../../src/modules/order/models/order.model'),
      orderitems: require('../../../../src/modules/order/models/orderItem.model'),
      financesnapshots: require('../../../../src/modules/finance/models/financeSnapshot.model'),
    };

    for (const entry of batchOne) {
      const declared = models[entry.collection].schema.indexes();
      expect(declared.some(([key]) => sameKeyPattern({ key }, entry.originalDefinition))).toBe(false);
    }
    expect(models.orders.schema.indexes()).toEqual(expect.arrayContaining([
      [{ salesChannelCode: 1, marketplaceCode: 1, externalOrderId: 1 }, expect.objectContaining({ unique: true })],
    ]));
    expect(models.orderitems.schema.indexes()).toEqual(expect.arrayContaining([
      [{ orderId: 1, externalItemId: 1 }, expect.objectContaining({ unique: true })],
    ]));
    expect(models.financesnapshots.schema.indexes()).toEqual(expect.arrayContaining([
      [{ orderItemId: 1 }, expect.objectContaining({ unique: true })],
    ]));
  });
});
