const mongoose = require('mongoose');

const teamsSubscriptionSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    resource: {
      type: String,
      required: true,
      trim: true,
    },
    clientState: {
      type: String,
      required: true,
    },
    notificationUrl: {
      type: String,
      required: true,
      trim: true,
    },
    expirationDateTime: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'REVOKED'],
      default: 'ACTIVE',
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('TeamsSubscription', teamsSubscriptionSchema);
