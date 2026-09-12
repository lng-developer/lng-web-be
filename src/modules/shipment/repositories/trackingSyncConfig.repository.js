const TrackingSyncConfig = require('../models/trackingSyncConfig.model');

const KEY = 'DEFAULT';

function get() {
  return TrackingSyncConfig.findOne({ key: KEY }).lean();
}

function upsert(patch) {
  return TrackingSyncConfig.findOneAndUpdate(
    { key: KEY },
    { $set: patch, $setOnInsert: { key: KEY } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { get, upsert };
