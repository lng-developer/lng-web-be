const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  nextRunAt: { type: Date, required: true },
  lastError: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });
schema.index({ enabled: 1, nextRunAt: 1 });
module.exports = mongoose.model('ListingImageSyncSchedule', schema);
