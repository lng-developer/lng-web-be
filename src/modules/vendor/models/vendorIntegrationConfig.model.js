const mongoose = require('mongoose');
const {
  vendorIntegrationAuthTypes,
  vendorIntegrationModes,
  vendorIntegrationStatuses,
  nativeVendorProviderKeys,
  vendorProviderKeys,
} = require('../constants/vendor.constants');

const vendorIntegrationConfigSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    mode: {
      type: String,
      enum: Object.values(vendorIntegrationModes),
      default: null,
      index: true,
    },
    adapterKey: {
      type: String,
      uppercase: true,
      trim: true,
      enum: nativeVendorProviderKeys,
      default: null,
      index: true,
    },
    providerKey: {
      type: String,
      required: false,
      uppercase: true,
      trim: true,
      enum: Object.values(vendorProviderKeys),
      default: null,
      index: true,
    },
    baseUrl: {
      type: String,
      required() {
        return this.mode !== vendorIntegrationModes.MANUAL;
      },
      trim: true,
      default: null,
    },
    orderEndpointUrl: { type: String, trim: true, default: null },
    trackingEndpointUrl: { type: String, trim: true, default: null },
    pushOrderEndpointUrl: { type: String, trim: true, default: null },
    authType: {
      type: String,
      required() {
        return this.mode !== vendorIntegrationModes.MANUAL;
      },
      uppercase: true,
      trim: true,
      enum: Object.values(vendorIntegrationAuthTypes),
      default: null,
    },
    accessTokenEncrypted: { type: String, default: null },
    refreshTokenEncrypted: { type: String, default: null },
    usernameEncrypted: { type: String, default: null },
    passwordEncrypted: { type: String, default: null },
    apiKeyEncrypted: { type: String, default: null },
    apiSecretEncrypted: { type: String, default: null },
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

vendorIntegrationConfigSchema.pre('validate', function validateIntegrationMode() {
  if (this.mode === vendorIntegrationModes.NATIVE && !this.adapterKey && !this.providerKey) {
    this.invalidate('adapterKey', 'Native integration requires adapterKey');
  }
  if (this.mode === vendorIntegrationModes.GENERIC_API && this.adapterKey) {
    this.invalidate('adapterKey', 'Generic API integration cannot have adapterKey');
  }
});

vendorIntegrationConfigSchema.index({ vendorId: 1 }, { unique: true });
vendorIntegrationConfigSchema.index({ providerKey: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('VendorIntegrationConfig', vendorIntegrationConfigSchema);
