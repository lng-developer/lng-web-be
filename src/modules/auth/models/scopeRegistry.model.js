const mongoose = require('mongoose');
const {
  accessScopeTypes,
  scopeRegistryStatuses,
} = require('../constants/auth.constants');

const registryScopeTypes = [
  accessScopeTypes.DEPARTMENT,
  accessScopeTypes.TEAM,
  accessScopeTypes.SHOP,
  accessScopeTypes.VENDOR,
];

const scopeRegistrySchema = new mongoose.Schema(
  {
    scopeType: {
      type: String,
      enum: registryScopeTypes,
      required: true,
      index: true,
    },
    scopeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(scopeRegistryStatuses),
      required: true,
      default: scopeRegistryStatuses.ACTIVE,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

scopeRegistrySchema.index({ scopeType: 1, scopeId: 1 }, { unique: true });

module.exports = mongoose.model('ScopeRegistry', scopeRegistrySchema);
