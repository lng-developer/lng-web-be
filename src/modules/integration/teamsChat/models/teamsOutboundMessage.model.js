const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  lngMessageId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  senderAccountId: { type: mongoose.Schema.Types.ObjectId, default: null },
  body: { type: String, required: true },
  participantAccountIds: [{ type: mongoose.Schema.Types.ObjectId }],
  title: { type: String, default: null },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'RETRY', 'SENT', 'FAILED'], default: 'PENDING', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: null },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1 });
module.exports = mongoose.model('TeamsOutboundMessage', schema);
