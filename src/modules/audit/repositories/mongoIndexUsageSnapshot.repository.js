const MongoIndexUsageSnapshot = require('../models/mongoIndexUsageSnapshot.model');

async function upsertDaily(snapshot) {
  return MongoIndexUsageSnapshot.findOneAndUpdate(
    { capturedOn: snapshot.capturedOn },
    { $set: snapshot },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}

async function listRecent({ limit }) {
  return MongoIndexUsageSnapshot.find({})
    .sort({ capturedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
}

module.exports = { listRecent, upsertDaily };
