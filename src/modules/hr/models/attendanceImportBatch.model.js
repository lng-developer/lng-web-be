const mongoose = require('mongoose');

const attendanceImportBatchSchema = new mongoose.Schema({
  sourceBatchId: { type: String, required: true, unique: true, trim: true },
  status: { type: String, enum: ['PROCESSING', 'COMPLETED', 'FAILED'], required: true },
  punchCount: { type: Number, min: 0, required: true },
  result: {
    inserted: { type: Number, min: 0, default: 0 },
    updated: { type: Number, min: 0, default: 0 },
    unchanged: { type: Number, min: 0, default: 0 },
    failed: { type: Number, min: 0, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model('HrAttendanceImportBatch', attendanceImportBatchSchema);
