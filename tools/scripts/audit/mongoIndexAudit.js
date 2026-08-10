const OPTION_KEYS = ['unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression', 'collation'];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function sameKeyPattern(left, right) {
  return sameValue(left?.key || {}, right?.key || {});
}

function hasCompatibleOptions(left = {}, right = {}) {
  return OPTION_KEYS.every((key) => sameValue(left[key] ?? null, right[key] ?? null));
}

function isLeftPrefix(covered = {}, covering = {}) {
  if (!hasCompatibleOptions(covered, covering)) return false;
  const left = Object.entries(covered.key || {});
  const right = Object.entries(covering.key || {});
  if (!left.length || left.length >= right.length) return false;
  return left.every(([field, direction], index) => {
    const [rightField, rightDirection] = right[index] || [];
    if (field !== rightField) return false;
    if (direction === rightDirection) return true;
    return left.length === 1 && [direction, rightDirection].every((value) => value === 1 || value === -1);
  });
}

function protectsCorrectness(index = {}) {
  return index.name === '_id_' || OPTION_KEYS.some((key) => index[key] !== undefined && index[key] !== false);
}

function classifyIndexes(indexes = []) {
  return indexes.map((index) => {
    if (protectsCorrectness(index)) {
      return { indexName: index.name, classification: 'KEEP', coveredBy: null, reason: 'correctness options or _id' };
    }
    const duplicate = indexes.find((candidate) => candidate.name !== index.name
      && sameKeyPattern(index, candidate) && hasCompatibleOptions(index, candidate));
    if (duplicate) {
      return { indexName: index.name, classification: 'DUPLICATE', coveredBy: duplicate.name, reason: 'identical key and options' };
    }
    const covering = indexes.find((candidate) => candidate.name !== index.name && isLeftPrefix(index, candidate));
    if (covering) {
      return { indexName: index.name, classification: 'COVERED', coveredBy: covering.name, reason: 'compatible compound left prefix' };
    }
    return { indexName: index.name, classification: 'KEEP', coveredBy: null, reason: 'no compatible covering index' };
  });
}

async function collectMongoIndexAudit(db, collectionNames) {
  const dbStats = await db.command({ dbStats: 1 });
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  const collections = [];
  for (const name of collectionNames.filter((value) => existing.has(value))) {
    const collection = db.collection(name);
    const [stats, definitions] = await Promise.all([
      db.command({ collStats: name }),
      collection.listIndexes().toArray(),
    ]);
    let usage = [];
    let usageAvailable = true;
    try {
      usage = await collection.aggregate([{ $indexStats: {} }]).toArray();
    } catch (error) {
      if (!/not authorized|unauthorized/i.test(error.message)) throw error;
      usageAvailable = false;
    }
    const operationsByName = new Map(usage.map((entry) => [entry.name, entry.accesses?.ops || 0]));
    collections.push({
      name,
      documentCount: stats.count || 0,
      dataBytes: stats.size || 0,
      storageBytes: stats.storageSize || 0,
      indexBytes: stats.totalIndexSize || 0,
      indexCount: stats.nindexes || definitions.length,
      usageAvailable,
      indexes: definitions.map((definition) => ({
        ...definition,
        operations: usageAvailable ? operationsByName.get(definition.name) || 0 : null,
      })),
      findings: classifyIndexes(definitions),
    });
  }
  return {
    database: db.databaseName,
    generatedAt: new Date().toISOString(),
    totals: {
      dataBytes: dbStats.dataSize || 0,
      storageBytes: dbStats.storageSize || 0,
      indexBytes: dbStats.indexSize || 0,
      collections: dbStats.collections || 0,
      indexes: dbStats.indexes || 0,
    },
    collections,
  };
}

module.exports = {
  classifyIndexes,
  collectMongoIndexAudit,
  hasCompatibleOptions,
  isLeftPrefix,
  sameKeyPattern,
};
