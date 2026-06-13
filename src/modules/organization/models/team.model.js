const mongoose = require('mongoose');
const { organizationStatuses } = require('../constants');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
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

module.exports = mongoose.model('Team', teamSchema);
