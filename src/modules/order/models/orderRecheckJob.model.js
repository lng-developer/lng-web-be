const mongoose = require('mongoose');

const orderRecheckJobSchema = new mongoose.Schema({
  orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, enum: ['MAPPING', 'PRODUCTION'], required: true },
  status: { type: String, enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'], default: 'QUEUED', index: true },
  activeKey: { type: String, required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  errorMessage: { type: String, default: null },
}, { timestamps: true });

orderRecheckJobSchema.index({ orderItemId: 1, type: 1, createdAt: -1 });
orderRecheckJobSchema.index({ shopId: 1, status: 1, createdAt: -1 });
orderRecheckJobSchema.index({ activeKey: 1 }, {
  unique: true,
  partialFilterExpression: { activeKey: { $type: 'string' } },
});

module.exports = mongoose.model('OrderRecheckJob', orderRecheckJobSchema);
