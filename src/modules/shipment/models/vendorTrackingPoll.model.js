const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId, // Vendor submission ID, unique across schedulers.
  provider: String,
  lastAttemptAt: Date,
  nextCheckAt: Date,
  attempt: { type: Number, default: 0 },
  leaseToken: String,
  leaseExpiresAt: Date,
  lastOutcome: String,
  pendingUpdate: { type: new mongoose.Schema({
    identity: String, guardKey: String, observed: String, provider: String, shipmentStatus: String, trackingNumber: String,
    carrier: String, trackingUrl: String, shippedAt: Date,
  }, { _id: false }), default: undefined },
}, { timestamps: true, collection: 'vendortrackingpolls' });
schema.index({ nextCheckAt: 1, _id: 1 });
schema.index({ provider: 1, nextCheckAt: 1, _id: 1 });
module.exports = mongoose.model('VendorTrackingPoll', schema);
