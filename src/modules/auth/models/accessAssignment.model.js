const mongoose = require('mongoose');
const {
  accessAssignmentStatuses,
  accessScopeTypes,
} = require('../constants/auth.constants');

const scopedTypesRequiringId = new Set([
  accessScopeTypes.DEPARTMENT,
  accessScopeTypes.TEAM,
  accessScopeTypes.SHOP,
  accessScopeTypes.VENDOR,
]);

const accessAssignmentSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
      index: true,
    },
    scopeType: {
      type: String,
      enum: Object.values(accessScopeTypes),
      required: true,
      index: true,
    },
    scopeId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    customPermissions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Permission',
    }],
    status: {
      type: String,
      enum: Object.values(accessAssignmentStatuses),
      required: true,
      default: accessAssignmentStatuses.ACTIVE,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

accessAssignmentSchema.pre('validate', function validateScopeId() {
  if (scopedTypesRequiringId.has(this.scopeType) && !this.scopeId) {
    this.invalidate('scopeId', 'scopeId is required for scoped access assignments');
  }

  if (
    [accessScopeTypes.GLOBAL, accessScopeTypes.OWN].includes(this.scopeType)
    && this.scopeId
  ) {
    this.invalidate('scopeId', 'scopeId must be null for global and own access assignments');
  }
});

accessAssignmentSchema.index(
  {
    accountId: 1,
    roleId: 1,
    scopeType: 1,
    scopeId: 1,
  },
  {
    unique: true,
    partialFilterExpression: { status: accessAssignmentStatuses.ACTIVE },
  },
);

module.exports = mongoose.model('AccessAssignment', accessAssignmentSchema);
