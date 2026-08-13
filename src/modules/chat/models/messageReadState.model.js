const mongoose = require('mongoose');

const messageReadStateSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  lastReadAt: { type: Date, required: true },
}, { timestamps: true });

messageReadStateSchema.index({ conversationId: 1, accountId: 1 }, { unique: true });

module.exports = mongoose.model('ChatMessageReadState', messageReadStateSchema);
