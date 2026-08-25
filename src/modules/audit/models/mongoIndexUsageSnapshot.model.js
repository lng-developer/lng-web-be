const mongoose = require('mongoose');

const mongoIndexUsageSnapshotSchema = new mongoose.Schema({
  capturedOn: { type: String, required: true, unique: true, trim: true },
  capturedAt: { type: Date, required: true },
  database: { type: String, required: true, trim: true },
  totals: { type: mongoose.Schema.Types.Mixed, required: true },
  collections: { type: [mongoose.Schema.Types.Mixed], required: true },
}, { timestamps: { createdAt: true, updatedAt: true }, versionKey: false, collection: 'mongoIndexUsageSnapshots' });

mongoIndexUsageSnapshotSchema.index({ capturedAt: -1, _id: -1 }, { name: 'mongo_index_usage_snapshot_timeline' });

module.exports = mongoose.model('MongoIndexUsageSnapshot', mongoIndexUsageSnapshotSchema);
