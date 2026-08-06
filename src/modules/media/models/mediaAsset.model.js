const mongoose = require('mongoose');

const mediaAssetSchema = new mongoose.Schema(
  {
    originalFilename: {
      type: String,
      trim: true,
      default: null,
    },
    storageFilename: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    mimeType: {
      type: String,
      trim: true,
      default: null,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{PATH} must be an integer',
      },
    },
    sha256: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    relativeStoragePath: {
      type: String,
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      trim: true,
      default: 'local',
      index: true,
    },
    assetPurpose: {
      type: String,
      enum: ['PSD_TEMPLATE', 'DESIGN_PACKAGE', 'PRINT_READY', 'PREVIEW', 'OTHER'],
      default: 'OTHER',
      index: true,
    },
    uploadStatus: {
      type: String,
      enum: ['UPLOADING', 'VERIFYING', 'READY', 'FAILED', 'ABORTED'],
      default: 'READY',
      index: true,
    },
    providerAssetId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    resourceType: {
      type: String,
      trim: true,
      default: null,
    },
    secureUrl: {
      type: String,
      trim: true,
      default: null,
    },
    sourceUrlRedacted: {
      type: String,
      trim: true,
      default: null,
    },
    sourceUrlHash: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
    },
    ownerType: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    discardedAt: {
      type: Date,
      default: null,
      index: true,
    },
    discardReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

mediaAssetSchema.index({ sha256: 1, size: 1 });
mediaAssetSchema.index({ provider: 1, uploadStatus: 1, 'metadata.expiresAt': 1 });

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
