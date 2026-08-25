function toMongoIndexUsageSnapshotDto(snapshot) {
  return Object.assign(Object.create(null), {
    capturedOn: snapshot.capturedOn,
    capturedAt: snapshot.capturedAt,
    database: snapshot.database,
    totals: snapshot.totals,
    collections: (snapshot.collections || []).map((collection) => Object.assign(Object.create(null), {
      name: collection.name,
      documentCount: collection.documentCount,
      dataBytes: collection.dataBytes,
      storageBytes: collection.storageBytes,
      indexBytes: collection.indexBytes,
      indexCount: collection.indexCount,
      usageAvailable: collection.usageAvailable,
      indexes: (collection.indexes || []).map((index) => Object.assign(Object.create(null), {
        name: index.name,
        key: index.key,
        operations: index.operations,
      })),
      findings: collection.findings || [],
    })),
  });
}

module.exports = { toMongoIndexUsageSnapshotDto };
