const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true, index: true },
  senderAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  body: {
    type: String,
    trim: true,
    maxlength: 4000,
    default: '',
  },
  assetIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' }],
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
  idempotencyKey: { type: String, trim: true, unique: true, sparse: true },
  replyToMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null, index: true },
}, { timestamps: true });

messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('ChatMessage', messageSchema);
