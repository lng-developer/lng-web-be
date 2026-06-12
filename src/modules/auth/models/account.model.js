const mongoose = require('mongoose');
const { accountStatuses } = require('../constants/auth.constants');

const refreshSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    replacedBySessionId: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
  },
  {
    _id: false,
    timestamps: true,
  },
);

const accountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    normalizedEmail: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    passwordSalt: {
      type: String,
      required: true,
      select: false,
    },
    sessions: {
      type: [refreshSessionSchema],
      default: [],
    },
    tokenVersion: {
      type: Number,
      required: true,
      default: 0,
    },
    status: {
      type: String,
      enum: Object.values(accountStatuses),
      required: true,
      default: accountStatuses.ACTIVE,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastLoginIp: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Account', accountSchema);
