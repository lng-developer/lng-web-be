const mongoose = require('mongoose');
const { TEAMS_SYNC_DIRECTIONS, TEAMS_SYNC_STATUSES } = require('../constants/teams.constants');

const teamsMessageMappingSchema = new mongoose.Schema(
  {
    lngMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
      unique: true,
      index: true,
    },
    teamsMessageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    teamsChatId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: Object.values(TEAMS_SYNC_DIRECTIONS),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(TEAMS_SYNC_STATUSES),
      default: TEAMS_SYNC_STATUSES.SYNCED,
    },
    errorDetails: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

teamsMessageMappingSchema.index({ teamsChatId: 1, teamsMessageId: 1 });

module.exports = mongoose.model('TeamsMessageMapping', teamsMessageMappingSchema);
