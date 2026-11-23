const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: String,
  reason: String,
  failedVersion: Number,
  failedAt: Date,
  lastError: String,
  requestedVersion: { type: Number, default: 0 },
  completedVersion: { type: Number, default: 0 },
  pending: { type: Boolean, default: false },
  batchIds: [String],
  nextSignalAt: Date,
});
schema.index({ pending: 1, nextSignalAt: 1, _id: 1 });
module.exports = mongoose.model('FinanceRecalculationRequest', schema);
