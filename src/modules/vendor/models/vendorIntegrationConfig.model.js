const mongoose = require('mongoose');
const {
  vendorIntegrationAuthTypes,
  vendorIntegrationStatuses,
  vendorProviderKeys,
} = require('../constants/vendor.constants');

const vendorIntegrationConfigSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    providerKey: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: Object.values(vendorProviderKeys),
      index: true,
    },
    baseUrl: {
      type: String,
      required: true,
      trim: true,
    },
    authType: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: Object.values(vendorIntegrationAuthTypes),
    },
    accessTokenEncrypted: { type: String, default: null },
    refreshTokenEncrypted: { type: String, default: null },
    usernameEncrypted: { type: String, default: null },
    passwordEncrypted: { type: String, default: null },
    expiresAt: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: Object.values(vendorIntegrationStatuses),
      default: vendorIntegrationStatuses.DISCONNECTED,
      index: true,
    },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, trim: true, default: null },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

vendorIntegrationConfigSchema.index({ vendorId: 1 }, { unique: true });
vendorIntegrationConfigSchema.index({ providerKey: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('VendorIntegrationConfig', vendorIntegrationConfigSchema);
