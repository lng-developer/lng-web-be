const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  items: { type: mongoose.Schema.Types.Mixed, default: {} },
  requestedVersion: { type: Number, default: 0 },
  completedVersion: { type: Number, default: 0 },
  leaseToken: { type: String, default: null },
  leaseExpiresAt: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 },
  blocked: { type: Boolean, default: false },
  lastErrorCode: { type: String, default: null },
}, { timestamps: true });
schema.index({ blocked: 1, nextAttemptAt: 1, leaseExpiresAt: 1 });
module.exports = mongoose.model('FulfillmentSideEffectRequest', schema);
