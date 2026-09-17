const mongoose = require('mongoose');
const itemSchema = new mongoose.Schema({
  listingId: { type: mongoose.Schema.Types.ObjectId, required: true },
  asin: { type: String, required: true },
  marketplaceCode: { type: String, default: 'US' },
  status: { type: String, enum: ['PENDING', 'SUCCEEDED', 'UNCHANGED', 'SKIPPED', 'FAILED'], default: 'PENDING' },
  commandId: { type: mongoose.Schema.Types.ObjectId, default: null },
  errorCode: String,
  errorMessage: { type: String, maxlength: 300 },
  completedAt: Date,
  resultToken: String,
  resultUntil: Date,
});
const schema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  activeShopKey: String,
  status: { type: String, enum: ['QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'COMPLETED_WITH_ERRORS'], default: 'QUEUED' },
  // ponytail: bounded embedded checkpoints; use an item collection above 10000 listings.
  items: { type: [itemSchema], validate: [(items) => items.length <= 10000, 'Image sync jobs support at most 10000 listings'] },
  batchCommandId: { type: mongoose.Schema.Types.ObjectId, default: null },
  dispatchUntil: { type: Date, default: null },
  dispatchToken: String,
  errorMessage: { type: String, maxlength: 1000, default: null },
}, { timestamps: true });
schema.index({ activeShopKey: 1 }, { unique: true, sparse: true });
schema.index({ shopId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: 1 });
module.exports = mongoose.model('ListingImageSyncJob', schema);
