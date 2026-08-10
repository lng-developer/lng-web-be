const config = require('../../../src/config');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const { hasCompatibleOptions, sameKeyPattern } = require('../audit/mongoIndexAudit');
const { databaseTarget } = require('./applyMongoIndexReduction');
const { reductions, requiredIndexes } = require('./mongoIndexReconciliation.batch2');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function createOptions(definition) {
  const { key, ...options } = definition;
  return options;
}

function matches(actual, expected) {
  return sameKeyPattern(actual, expected) && hasCompatibleOptions(actual, expected);
}

function rollbackLine(collection, definition) {
  return `db.${collection}.createIndex(${JSON.stringify(definition.key)}, ${JSON.stringify(createOptions(definition))})`;
}

async function main({
  argv = process.argv.slice(2),
  databaseUri = config.database.uri,
  connectDatabase: connect = connectDatabase,
  disconnectDatabase: disconnect = disconnectDatabase,
  output = process.stdout,
} = {}) {
  const unknown = argv.filter((value) => !['--apply', '--allow-remote'].includes(value));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const apply = argv.includes('--apply');
  const allowRemote = argv.includes('--allow-remote');
  if (allowRemote && !apply) throw new Error('--allow-remote requires --apply');

  const target = databaseTarget(databaseUri);
  const local = target.hosts.every((host) => LOCAL_HOSTS.has(host));
  if (apply && (target.database !== 'lng_web_be' || (!local && !allowRemote))) {
    throw new Error('Refusing to apply index reconciliation to a non-local database');
  }

  let connected = false;
  try {
    const connection = await connect();
    connected = true;
    const db = connection.db || connection;
    if (db.databaseName !== 'lng_web_be') throw new Error(`Unexpected database: ${db.databaseName}`);

    const collectionNames = [...new Set([
      ...requiredIndexes.map(({ collection }) => collection),
      ...reductions.map(({ collection }) => collection),
    ])];
    const installedByCollection = new Map();
    for (const name of collectionNames) {
      installedByCollection.set(name, await db.collection(name).listIndexes().toArray());
    }

    for (const entry of reductions) {
      const installed = installedByCollection.get(entry.collection);
      const removable = installed.find(({ name }) => name === entry.indexName);
      const covering = installed.find(({ name }) => name === entry.coveredBy.name);
      if (!removable || !covering
        || !matches(removable, entry.originalDefinition)
        || !matches(covering, entry.coveredBy)) {
        throw new Error(`Index definition mismatch: ${entry.collection}.${entry.indexName}`);
      }
    }

    const requiredState = [];
    for (const entry of requiredIndexes) {
      const installed = installedByCollection.get(entry.collection);
      const sameName = installed.find(({ name }) => name === entry.desiredDefinition.name);
      const ready = sameName && matches(sameName, entry.desiredDefinition);
      const legacy = entry.installedDefinition && sameName && matches(sameName, entry.installedDefinition);
      if (sameName && !ready && !legacy) {
        throw new Error(`Index definition mismatch: ${entry.collection}.${entry.desiredDefinition.name}`);
      }
      const duplicates = await db.collection(entry.collection)
        .aggregate(entry.duplicatePipeline)
        .toArray();
      if (duplicates.length) throw new Error(`Cannot create unique index: duplicate values in ${entry.collection}`);
      requiredState.push({ entry, ready, legacy });
    }

    output.write(`${apply ? 'APPLY' : 'DRY RUN'} database=${db.databaseName}\n`);
    for (const { entry, ready, legacy } of requiredState) {
      output.write(`${ready ? 'KEEP' : legacy ? 'REPLACE' : 'CREATE'} ${entry.collection}.${entry.desiredDefinition.name}\n`);
      if (legacy) output.write(`ROLLBACK ${rollbackLine(entry.collection, entry.installedDefinition)}\n`);
    }
    for (const entry of reductions) {
      output.write(`DROP ${entry.collection}.${entry.indexName} coveredBy=${entry.coveredBy.name}\n`);
      output.write(`ROLLBACK ${rollbackLine(entry.collection, entry.originalDefinition)}\n`);
    }

    if (apply) {
      for (const { entry, ready, legacy } of requiredState) {
        if (ready) continue;
        const collection = db.collection(entry.collection);
        if (legacy) await collection.dropIndex(entry.installedDefinition.name);
        try {
          await collection.createIndex(entry.desiredDefinition.key, createOptions(entry.desiredDefinition));
        } catch (error) {
          if (legacy) {
            try {
              await collection.createIndex(entry.installedDefinition.key, createOptions(entry.installedDefinition));
            } catch (restoreError) {
              error.message += `; rollback failed: ${restoreError.message}`;
            }
          }
          throw error;
        }
      }
      for (const entry of reductions) {
        await db.collection(entry.collection).dropIndex(entry.indexName);
      }

      for (const entry of requiredIndexes) {
        const installed = await db.collection(entry.collection).listIndexes().toArray();
        const actual = installed.find(({ name }) => name === entry.desiredDefinition.name);
        if (!actual || !matches(actual, entry.desiredDefinition)) {
          throw new Error(`Unique index verification failed: ${entry.collection}.${entry.desiredDefinition.name}`);
        }
      }
      for (const entry of reductions) {
        const installed = await db.collection(entry.collection).listIndexes().toArray();
        if (installed.some(({ name }) => name === entry.indexName)
          || !installed.some(({ name }) => name === entry.coveredBy.name)) {
          throw new Error(`Index reduction verification failed: ${entry.collection}.${entry.indexName}`);
        }
      }
    }

    return {
      applied: apply,
      database: db.databaseName,
      requiredIndexes: requiredIndexes.length,
      reductions: reductions.length,
    };
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
