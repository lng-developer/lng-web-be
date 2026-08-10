const { batchOne } = require('../../../../tools/scripts/maintenance/mongoIndexReduction.batch1');

function installedFor(entries = batchOne) {
  const byCollection = new Map();
  for (const entry of entries) {
    if (!byCollection.has(entry.collection)) byCollection.set(entry.collection, []);
    byCollection.get(entry.collection).push(entry.originalDefinition, entry.coveredBy);
  }
  return byCollection;
}

function dependencies(entries = batchOne) {
  const installed = installedFor(entries);
  const collections = new Map();
  for (const [name, definitions] of installed) {
    collections.set(name, {
      listIndexes: () => ({ toArray: async () => definitions }),
      dropIndex: jest.fn(),
    });
  }
  const db = { databaseName: 'lng_web_be', collection: (name) => collections.get(name) };
  return {
    db,
    collections,
    output: { write: jest.fn() },
    connectDatabase: jest.fn().mockResolvedValue({ db }),
    disconnectDatabase: jest.fn(),
  };
}

describe('applyMongoIndexReduction', () => {
  test('defaults to dry-run and never drops an index', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReduction');
    const deps = dependencies();

    await main({ argv: [], databaseUri: 'mongodb://127.0.0.1:27017/lng_web_be', ...deps });

    for (const collection of deps.collections.values()) expect(collection.dropIndex).not.toHaveBeenCalled();
    expect(deps.output.write).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
  });

  test('rejects apply for a non-local database', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReduction');
    const deps = dependencies();

    await expect(main({
      argv: ['--apply'],
      databaseUri: 'mongodb://mongo.internal:27017/lng_web_be',
      ...deps,
    })).rejects.toThrow('non-local database');
  });

  test('allows an explicitly approved remote apply for the expected database', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReduction');
    const deps = dependencies();

    await main({
      argv: ['--apply', '--allow-remote'],
      databaseUri: 'mongodb+srv://cluster.example.net/lng_web_be',
      ...deps,
    });

    expect(deps.collections.get('orders').dropIndex).toHaveBeenCalledWith('orderedAt_1');
  });

  test('validates the full manifest then drops exact names locally', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReduction');
    const deps = dependencies();

    await main({ argv: ['--apply'], databaseUri: 'mongodb://localhost:27017/lng_web_be', ...deps });

    expect(deps.collections.get('orders').dropIndex).toHaveBeenCalledWith('orderedAt_1');
    expect(deps.output.write).toHaveBeenCalledWith(expect.stringContaining('ROLLBACK'));
  });

  test('aborts before drops when an installed definition drifted', async () => {
    const { main } = require('../../../../tools/scripts/maintenance/applyMongoIndexReduction');
    const deps = dependencies();
    deps.collections.get('orders').listIndexes = () => ({ toArray: async () => [] });

    await expect(main({
      argv: ['--apply'], databaseUri: 'mongodb://localhost:27017/lng_web_be', ...deps,
    })).rejects.toThrow('definition mismatch');
    for (const collection of deps.collections.values()) expect(collection.dropIndex).not.toHaveBeenCalled();
  });
});
