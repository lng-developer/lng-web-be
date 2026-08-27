process.env.MONGODB_URI ||= 'mongodb://localhost:27017/lng_web_be_test';

const { reductions, requiredIndexes } = require('../../../../tools/scripts/maintenance/mongoIndexReconciliation.batch2');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dependencies() {
  const definitions = new Map();
  for (const entry of reductions) {
    if (!definitions.has(entry.collection)) definitions.set(entry.collection, []);
    definitions.get(entry.collection).push(clone(entry.originalDefinition), clone(entry.coveredBy));
  }
  for (const entry of requiredIndexes) {
    if (!definitions.has(entry.collection)) definitions.set(entry.collection, []);
    if (entry.installedDefinition) definitions.get(entry.collection).push(clone(entry.installedDefinition));
  }

  const collections = new Map();
  for (const [name, installed] of definitions) {
    const state = installed;
    collections.set(name, {
      aggregate: jest.fn(() => ({ toArray: async () => [] })),
      createIndex: jest.fn(async (key, options) => {
        state.push({ key: clone(key), ...clone(options) });
        return options.name;
      }),
      dropIndex: jest.fn(async (indexName) => {
        const index = state.findIndex(({ name: candidate }) => candidate === indexName);
        if (index >= 0) state.splice(index, 1);
      }),
      listIndexes: jest.fn(() => ({ toArray: async () => clone(state) })),
    });
  }

  const db = { databaseName: 'lng_web_be', collection: (name) => collections.get(name) };
  return {
    collections,
    output: { write: jest.fn() },
    connectDatabase: jest.fn().mockResolvedValue({ db }),
    disconnectDatabase: jest.fn(),
  };
}

describe('applyMongoIndexReconciliationBatch2', () => {
  test('dry-run prints the exact plan without writing', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReconciliationBatch2');
    const deps = dependencies();

    const result = await main({
      argv: [],
      databaseUri: 'mongodb://localhost:27017/lng_web_be',
      ...deps,
    });

    expect(result).toEqual({ applied: false, database: 'lng_web_be', requiredIndexes: 2, reductions: 10 });
    for (const collection of deps.collections.values()) {
      expect(collection.dropIndex).not.toHaveBeenCalled();
      expect(collection.createIndex).not.toHaveBeenCalled();
    }
    expect(deps.output.write).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
  });

  test('remote apply reconciles required indexes then drops only the allowlist', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReconciliationBatch2');
    const deps = dependencies();

    await main({
      argv: ['--apply', '--allow-remote'],
      databaseUri: 'mongodb+srv://cluster.example.net/lng_web_be',
      ...deps,
    });

    expect(deps.collections.get('listings').createIndex).toHaveBeenCalledWith(
      { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, asin: 1 },
      {
        name: 'shopId_1_salesChannelCode_1_marketplaceCode_1_asin_1',
        unique: true,
        partialFilterExpression: { asin: { $type: 'string', $gt: '' } },
      },
    );
    expect(deps.collections.get('hrattendanceimportbatches').createIndex)
      .toHaveBeenCalledWith({ sourceBatchId: 1 }, { name: 'sourceBatchId_1', unique: true });
    expect(reductions).toHaveLength(10);
    for (const entry of reductions) {
      expect(deps.collections.get(entry.collection).dropIndex).toHaveBeenCalledWith(entry.indexName);
    }
  });

  test('duplicate preflight aborts before any write', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReconciliationBatch2');
    const deps = dependencies();
    deps.collections.get('listings').aggregate.mockReturnValueOnce({ toArray: async () => [{ count: 2 }] });

    await expect(main({
      argv: ['--apply'],
      databaseUri: 'mongodb://localhost:27017/lng_web_be',
      ...deps,
    })).rejects.toThrow('duplicate');

    for (const collection of deps.collections.values()) {
      expect(collection.dropIndex).not.toHaveBeenCalled();
      expect(collection.createIndex).not.toHaveBeenCalled();
    }
  });

  test('restores the listings legacy index when replacement fails', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReconciliationBatch2');
    const deps = dependencies();
    const listings = deps.collections.get('listings');
    listings.createIndex
      .mockRejectedValueOnce(new Error('replacement failed'))
      .mockResolvedValueOnce('shopId_1_salesChannelCode_1_marketplaceCode_1_asin_1');

    await expect(main({
      argv: ['--apply'],
      databaseUri: 'mongodb://localhost:27017/lng_web_be',
      ...deps,
    })).rejects.toThrow('replacement failed');

    expect(listings.createIndex).toHaveBeenLastCalledWith(
      { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, asin: 1 },
      { name: 'shopId_1_salesChannelCode_1_marketplaceCode_1_asin_1' },
    );
    for (const entry of reductions) {
      if (entry.collection !== 'listings') {
        expect(deps.collections.get(entry.collection).dropIndex).not.toHaveBeenCalled();
      }
    }
  });

  test('definition drift aborts before any write', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReconciliationBatch2');
    const deps = dependencies();
    deps.collections.get('orders').listIndexes.mockReturnValueOnce({ toArray: async () => [] });

    await expect(main({
      argv: ['--apply'],
      databaseUri: 'mongodb://localhost:27017/lng_web_be',
      ...deps,
    })).rejects.toThrow('definition mismatch');

    for (const collection of deps.collections.values()) {
      expect(collection.dropIndex).not.toHaveBeenCalled();
      expect(collection.createIndex).not.toHaveBeenCalled();
    }
  });
});

describe('batch-2 mongoose index contract', () => {
  test('keeps covering compound indexes without requesting redundant singles', () => {
    const cases = [
      [require('../../../../src/modules/vendor/models/vendorCostCenter.model'), { vendorProductId: 1 }, { vendorProductId: 1, status: 1 }],
      [require('../../../../src/modules/vendor/models/vendorCostCenter.model'), { vendorId: 1 }, { vendorId: 1, status: 1 }],
      [require('../../../../src/modules/order/models/order.model'), { shopId: 1 }, { shopId: 1, orderedAt: -1 }],
      [require('../../../../src/modules/order/models/order.model'), { salesChannelCode: 1 }, { salesChannelCode: 1, marketplaceCode: 1, externalStatus: 1 }],
      [require('../../../../src/modules/order/models/orderItem.model'), { salesChannelCode: 1 }, { salesChannelCode: 1, marketplaceCode: 1, externalOrderId: 1 }],
      [require('../../../../src/modules/catalog/models/listing.model'), { shopId: 1 }, { shopId: 1, status: 1, sku: 1 }],
    ];

    for (const [model, redundant, covering] of cases) {
      const keys = model.schema.indexes().map(([key]) => key);
      expect(keys).not.toContainEqual(redundant);
      expect(keys).toContainEqual(covering);
    }
  });
});
