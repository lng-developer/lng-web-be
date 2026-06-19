const mongoose = require('mongoose');
const { accessScopeTypes } = require('../constants/auth.constants');

const scopedRolePermissionScopeTypes = [
  accessScopeTypes.DEPARTMENT,
  accessScopeTypes.TEAM,
  accessScopeTypes.SHOP,
  accessScopeTypes.VENDOR,
];

const scopedRolePermissionSchema = new mongoose.Schema(
  {
    scopeType: {
      type: String,
      enum: scopedRolePermissionScopeTypes,
      required: true,
      index: true,
    },
    scopeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
      index: true,
    },
    permissions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Permission',
    }],
  },
  {
    timestamps: true,
  },
);

scopedRolePermissionSchema.index({ scopeType: 1, scopeId: 1, roleId: 1 }, { unique: true });
scopedRolePermissionSchema.index({ permissions: 1 });

module.exports = mongoose.model('ScopedRolePermission', scopedRolePermissionSchema);
