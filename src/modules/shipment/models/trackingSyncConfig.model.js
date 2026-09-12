const mongoose = require('mongoose');

const trackingSyncConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'DEFAULT' },
  enabled: { type: Boolean, default: false },
  intervalMinutes: { type: Number, enum: [5, 15, 30, 60], default: 15 },
  batchSize: { type: Number, enum: [10, 25, 50, 100], default: 50 },
  lastRunAt: { type: Date, default: null },
  lastRunFinishedAt: { type: Date, default: null },
  lastRunSummary: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = mongoose.model('TrackingSyncConfig', trackingSyncConfigSchema);
