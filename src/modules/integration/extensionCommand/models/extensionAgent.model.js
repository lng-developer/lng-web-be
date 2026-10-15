const mongoose = require('mongoose');

const extensionAgentSchema = new mongoose.Schema({
  extensionTokenId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  clientId: { type: String, required: true, trim: true, maxlength: 120 },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  version: { type: String, trim: true, maxlength: 40, default: null },
  provider: { type: String, enum: ['ETSY'], default: null },
  protocolVersion: { type: Number, enum: [1], default: null },
  apiBaseUrl: { type: String, trim: true, maxlength: 300, default: null },
  lastSeenAt: { type: Date, required: true, index: true },
  lastReconnectedAt: { type: Date, default: null },
}, { timestamps: true });

extensionAgentSchema.index({ extensionTokenId: 1, clientId: 1 }, { unique: true });
extensionAgentSchema.index({ shopId: 1, lastSeenAt: -1 });

module.exports = mongoose.model('ExtensionAgent', extensionAgentSchema);
