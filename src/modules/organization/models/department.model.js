const mongoose = require('mongoose');
const { organizationStatuses } = require('../constants');

const departmentSchema = new mongoose.Schema(
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

module.exports = mongoose.model('Department', departmentSchema);
