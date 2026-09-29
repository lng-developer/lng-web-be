const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  commandId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  shipmentIds: { type: [mongoose.Schema.Types.ObjectId], required: true },
  filename: { type: String, required: true },
  tsv: { type: String, required: true, select: false },
  checksum: { type: String, required: true },
  rowCount: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['QUEUED', 'SUBMITTED', 'WAITING_AMAZON', 'SUCCEEDED', 'FAILED'], default: 'QUEUED', index: true },
  amazonBatchId: { type: String, default: null },
  result: { importedCount: { type: Number, default: 0 }, failedCount: { type: Number, default: 0 }, diagnostics: { type: [String], default: undefined } },
}, { timestamps: true });

schema.index({ shopId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model('AmazonTrackingSubmission', schema);
