const mongoose = require('mongoose');

const indexOptionKeys = [
  'name',
  'unique',
  'sparse',
  'expireAfterSeconds',
  'partialFilterExpression',
  'collation',
  'hidden',
  'wildcardProjection',
  'weights',
  'default_language',
  'language_override',
  'textIndexVersion',
  '2dsphereIndexVersion',
  'bits',
  'min',
  'max',
  'bucketSize',
];

function readArgument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function assertCloneTarget(sourceName, targetName) {
  if (!sourceName || !targetName) throw new Error('source and target database names are required');
  if (sourceName === targetName) throw new Error('source and target database names must differ');
  if (!targetName.endsWith('_test')) throw new Error('target database name must end with _test');
  return true;
}

function parseIndexCollections(value) {
  if (!value) return null;
  return new Set(value.split(',').map((name) => name.trim()).filter(Boolean));
}

function indexOptions(index = {}) {
  return indexOptionKeys.reduce((options, key) => {
    if (index[key] !== undefined) options[key] = index[key];
    return options;
  }, {});
}

async function copyCollection(sourceDb, targetDb, collectionInfo, copyIndexes = true) {
  const { name, options = {} } = collectionInfo;
  const sourceCollection = sourceDb.collection(name);
  const targetCollection = await targetDb.createCollection(name, options);
  const cursor = sourceCollection.find({}, { batchSize: 500 });
  let batch = [];
  let copied = 0;

  for await (const document of cursor) {
    batch.push(document);
    if (batch.length < 500) continue;
    await targetCollection.insertMany(batch, { ordered: true });
    copied += batch.length;
    batch = [];
  }
  if (batch.length) {
    await targetCollection.insertMany(batch, { ordered: true });
    copied += batch.length;
  }

  let indexes = [];
  if (copyIndexes) {
    indexes = await sourceCollection.listIndexes().toArray();
    for (const index of indexes) {
      if (index.name === '_id_') continue;
      await targetCollection.createIndex(index.key, indexOptions(index));
    }
  }
  return { name, copied, indexes: indexes.length };
}

async function cloneDatabase({
  uri = process.env.MONGODB_URI,
  sourceName = readArgument('source'),
  targetName = readArgument('target'),
  indexCollections = parseIndexCollections(readArgument('index-collections')),
  output = console.log,
} = {}) {
  if (!uri) throw new Error('MONGODB_URI is required');
  assertCloneTarget(sourceName, targetName);

  const client = new mongoose.mongo.MongoClient(uri);
  await client.connect();
  try {
    const sourceDb = client.db(sourceName);
    const targetDb = client.db(targetName);
    const collections = await sourceDb.listCollections({ type: 'collection' }).toArray();
    if (!collections.length) throw new Error('source database has no collections');

    await targetDb.dropDatabase();
    const copied = [];
    for (const collection of collections) {
      copied.push(await copyCollection(
        sourceDb,
        targetDb,
        collection,
        !indexCollections || indexCollections.has(collection.name),
      ));
    }
    const targetCollections = await targetDb.listCollections({ type: 'collection' }).toArray();
    if (targetCollections.length !== collections.length) throw new Error('target collection count does not match source');

    const sourceDocuments = copied.reduce((total, item) => total + item.copied, 0);
    output(JSON.stringify({
      sourceDatabase: sourceName,
      targetDatabase: targetName,
      collections: copied.length,
      documents: sourceDocuments,
      indexes: copied.reduce((total, item) => total + item.indexes, 0),
    }));
    return copied;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  cloneDatabase().catch((error) => {
    process.stderr.write(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { assertCloneTarget, cloneDatabase, indexOptions, parseIndexCollections };
