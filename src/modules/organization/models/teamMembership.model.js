const mongoose = require('mongoose');
const {
  organizationStatuses,
  teamMemberTypes,
} = require('../constants');

const teamMembershipSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true,
    },
    memberType: {
      type: String,
      enum: Object.values(teamMemberTypes),
      required: true,
      default: teamMemberTypes.MEMBER,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(organizationStatuses),
      required: true,
      default: organizationStatuses.ACTIVE,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

teamMembershipSchema.index(
  { accountId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: organizationStatuses.ACTIVE },
  },
);

teamMembershipSchema.index({ accountId: 1, teamId: 1 });

module.exports = mongoose.model('TeamMembership', teamMembershipSchema);
