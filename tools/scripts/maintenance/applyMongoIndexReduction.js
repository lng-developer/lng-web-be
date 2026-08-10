const config = require('../../../src/config');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const { hasCompatibleOptions, sameKeyPattern } = require('../audit/mongoIndexAudit');
const { batchOne } = require('./mongoIndexReduction.batch1');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function databaseTarget(uri) {
  const match = String(uri).match(/^mongodb(?:\+srv)?:\/\/([^/]+)\/([^?]+)/i);
  if (!match) throw new Error('Invalid MongoDB URI');
  const hosts = match[1].split(',').map((host) => host.replace(/^.*@/, '').replace(/^\[|\](?=:|$)/g, '').split(':')[0]);
  return { hosts, database: decodeURIComponent(match[2]) };
}

function rollbackLine(entry) {
  const { name, key, v, ns, ...options } = entry.originalDefinition;
  return `db.${entry.collection}.createIndex(${JSON.stringify(key)}, ${JSON.stringify({ ...options, name })})`;
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
    throw new Error('Refusing to apply index reduction to a non-local database');
  }

  let connected = false;
  try {
    const connection = await connect();
    connected = true;
    const db = connection.db || connection;
    if (db.databaseName !== 'lng_web_be') throw new Error(`Unexpected database: ${db.databaseName}`);
    const installedByCollection = new Map();
    for (const collectionName of [...new Set(batchOne.map(({ collection }) => collection))]) {
      installedByCollection.set(collectionName, await db.collection(collectionName).listIndexes().toArray());
    }
    for (const entry of batchOne) {
      const definitions = installedByCollection.get(entry.collection);
      const installed = definitions.find(({ name }) => name === entry.indexName);
      const covering = definitions.find(({ name }) => name === entry.coveredBy.name);
      if (!installed || !covering
        || !sameKeyPattern(installed, entry.originalDefinition)
        || !hasCompatibleOptions(installed, entry.originalDefinition)
        || !sameKeyPattern(covering, entry.coveredBy)) {
        throw new Error(`Index definition mismatch: ${entry.collection}.${entry.indexName}`);
      }
    }

    output.write(`${apply ? 'APPLY' : 'DRY RUN'} database=${db.databaseName}\n`);
    for (const entry of batchOne) {
      output.write(`DROP ${entry.collection}.${entry.indexName} coveredBy=${entry.coveredBy.name}\n`);
      output.write(`ROLLBACK ${rollbackLine(entry)}\n`);
    }
    if (apply) {
      for (const entry of batchOne) await db.collection(entry.collection).dropIndex(entry.indexName);
    }
    return { applied: apply, database: db.databaseName, indexes: batchOne.length };
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

module.exports = { databaseTarget, main };
