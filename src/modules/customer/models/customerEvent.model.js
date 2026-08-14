const mongoose = require('mongoose');

const customerEventSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true,
  },
  eventType: { type: String, required: true, uppercase: true, trim: true, index: true },
  sourceModule: { type: String, required: true, trim: true },
  sourceId: { type: String, default: null, trim: true },
  message: { type: String, default: null, trim: true },
  occurredAt: { type: Date, default: Date.now, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

customerEventSchema.index({ customerId: 1, occurredAt: -1 });
customerEventSchema.index({ sourceModule: 1, sourceId: 1, eventType: 1 });

module.exports = mongoose.model('CustomerEvent', customerEventSchema);
