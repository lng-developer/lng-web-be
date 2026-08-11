const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  tokenHash: { type: String, required: true, unique: true, select: false },
  tokenHint: { type: String, required: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  environment: { type: String, required: true, enum: ['development', 'production'], index: true },
  createdByAccountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  lastUsedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ shopId: 1, environment: 1, revokedAt: 1, createdAt: -1 });
module.exports = mongoose.model('ExtensionToken', schema);
