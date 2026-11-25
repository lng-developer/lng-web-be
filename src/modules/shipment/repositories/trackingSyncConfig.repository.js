const TrackingSyncConfig = require('../models/trackingSyncConfig.model');

const KEY = 'DEFAULT';

function get() {
  return TrackingSyncConfig.findOne({ key: KEY }).lean();
}

function upsert(patch, insertDefaults = {}) {
  return TrackingSyncConfig.findOneAndUpdate(
    { key: KEY },
    { $set: patch, $setOnInsert: { key: KEY, ...insertDefaults } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { get, upsert };
