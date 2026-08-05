function buildTopLevelFieldPipeline() {
  return [
    { $project: { fields: { $objectToArray: '$$ROOT' } } },
    { $unwind: '$fields' },
    {
      $group: {
        _id: '$fields.k',
        presenceCount: { $sum: 1 },
        estimatedBytes: {
          $sum: { $bsonSize: { value: '$fields.v' } },
        },
        types: { $addToSet: { $type: '$fields.v' } },
      },
    },
    { $sort: { estimatedBytes: -1, _id: 1 } },
  ];
}

function normalizeFieldMetrics(rows = [], collectionDataBytes = 0) {
  return rows.map((row) => ({
    field: row._id,
    presenceCount: row.presenceCount || 0,
    estimatedBytes: row.estimatedBytes || 0,
    percentOfCollectionData: collectionDataBytes
      ? Math.round(((row.estimatedBytes || 0) / collectionDataBytes) * 10000) / 100
      : 0,
    types: row.types || [],
  }));
}

async function auditCollectionFields(db, collectionName) {
  const collection = db.collection(collectionName);
  const [stats, rows, indexes] = await Promise.all([
    db.command({ collStats: collectionName }),
    collection.aggregate(buildTopLevelFieldPipeline(), { allowDiskUse: true }).toArray(),
    collection.listIndexes().toArray(),
  ]);
  return {
    name: collectionName,
    documentCount: stats.count || 0,
    dataBytes: stats.size || 0,
    averageDocumentBytes: stats.avgObjSize || 0,
    fields: normalizeFieldMetrics(rows, stats.size || 0),
    indexes,
  };
}

async function auditMongoFields(db, collectionNames = []) {
  const collections = [];
  for (const name of collectionNames) collections.push(await auditCollectionFields(db, name));
  return { database: db.databaseName, generatedAt: new Date().toISOString(), collections };
}

module.exports = {
  auditCollectionFields,
  auditMongoFields,
  buildTopLevelFieldPipeline,
  normalizeFieldMetrics,
};
