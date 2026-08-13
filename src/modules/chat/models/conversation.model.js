const mongoose = require('mongoose');
const { chatConversationTypes } = require('../constants/chat.constants');

const conversationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Object.values(chatConversationTypes),
    required: true,
    uppercase: true,
    trim: true,
    index: true,
  },
  title: { type: String, trim: true, default: null },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', default: null, index: true },
  relatedResource: {
    type: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    id: { type: String, trim: true, default: null },
  },
  participantAccountIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
  }],
  directKey: { type: String, trim: true, default: null },
  lastMessageAt: { type: Date, default: null, index: true },
  lastMessagePreview: { type: String, trim: true, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
}, { timestamps: true });

conversationSchema.index({ participantAccountIds: 1, lastMessageAt: -1 });
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: 'string' } } },
);
conversationSchema.index(
  { type: 1, 'relatedResource.type': 1, 'relatedResource.id': 1 },
  { unique: true, partialFilterExpression: { 'relatedResource.id': { $type: 'string' } } },
);

module.exports = mongoose.model('ChatConversation', conversationSchema);
