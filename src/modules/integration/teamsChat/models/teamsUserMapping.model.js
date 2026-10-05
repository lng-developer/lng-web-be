const mongoose = require('mongoose');
const { TEAMS_USER_TYPES } = require('../constants/teams.constants');

const teamsUserMappingSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      sparse: true,
      index: true,
      default: null,
    },
    entraUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    displayName: {
      type: String,
      trim: true,
      default: null,
    },
    userType: {
      type: String,
      enum: Object.values(TEAMS_USER_TYPES),
      default: TEAMS_USER_TYPES.INTERNAL,
    },
    tenantId: {
      type: String,
      default: null,
    },
    encryptedRefreshToken: {
      type: String,
      select: false,
      default: null,
    },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'REVOKED'],
      default: 'ACTIVE',
    },
  },
  { timestamps: true },
);

teamsUserMappingSchema.index({ accountId: 1, entraUserId: 1 });

module.exports = mongoose.model('TeamsUserMapping', teamsUserMappingSchema);
