const mongoose = require('mongoose');

const sqlAttendanceSyncSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  status: { type: String, enum: ['IDLE', 'RUNNING', 'SUCCESS', 'FAILED'], default: 'IDLE' },
  lastSourceTimestamp: { type: Date, default: null },
  lastSourceId: { type: String, default: null },
  lastSourceBatchId: { type: String, default: null },
  lastResult: {
    fetched: { type: Number, min: 0, default: 0 },
    inserted: { type: Number, min: 0, default: 0 },
    updated: { type: Number, min: 0, default: 0 },
    unchanged: { type: Number, min: 0, default: 0 },
    failed: { type: Number, min: 0, default: 0 },
  },
  errorMessage: { type: String, default: null },
  lastStartedAt: { type: Date, default: null },
  lastFinishedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SqlAttendanceSync', sqlAttendanceSyncSchema);
