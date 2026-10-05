const mongoose = require('mongoose');

const teamsChatMappingSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      unique: true,
      index: true,
    },
    teamsChatId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    chatType: {
      type: String,
      default: 'oneOnOne',
    },
    participantEntraUserIds: {
      type: [String],
      default: [],
      index: true,
    },
    participantAccountIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
      },
    ],
    isExternal: {
      type: Boolean,
      default: false,
    },
    externalParticipantDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastSyncAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('TeamsChatMapping', teamsChatMappingSchema);
