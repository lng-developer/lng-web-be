const mongoose = require('mongoose');
const { collectMongoIndexAudit } = require('../../../shared/observability/mongoIndexUsage');
const repository = require('../repositories/mongoIndexUsageSnapshot.repository');
const { toMongoIndexUsageSnapshotDto } = require('../dtos/mongoIndexUsageSnapshot.dto');

const SNAPSHOT_COLLECTION = 'mongoIndexUsageSnapshots';

function capturedOn(date) {
  return date.toISOString().slice(0, 10);
}

async function collectAndStore({ db = mongoose.connection.db, snapshotRepository = repository } = {}) {
  if (!db) throw new Error('MongoDB connection is unavailable');
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(({ name }) => name)
    .filter((name) => name !== SNAPSHOT_COLLECTION);
  const report = await collectMongoIndexAudit(db, names);
  const capturedAt = new Date();
  const snapshot = await snapshotRepository.upsertDaily({
    ...report,
    capturedOn: capturedOn(capturedAt),
    capturedAt,
  });
  return { capturedOn: snapshot.capturedOn, collections: report.collections.length };
}

async function listRecent({ limit }) {
  return (await repository.listRecent({ limit })).map(toMongoIndexUsageSnapshotDto);
}

module.exports = { collectAndStore, listRecent };
