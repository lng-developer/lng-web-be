const mongoose = require('mongoose');
const { customizationStatuses } = require('../constants/customizationStatuses');

const supportedSources = ['AMAZON_EXTENSION_REPORT', 'MANUAL_EXCEL'];
const assetStatuses = [
  customizationStatuses.PENDING,
  customizationStatuses.DOWNLOADED,
  customizationStatuses.FAILED,
];

const assetSchema = new mongoose.Schema(
  {
    assetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    sourceUrl: {
      type: String,
      trim: true,
      default: null,
    },
    type: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    status: {
      type: String,
      enum: assetStatuses,
      default: customizationStatuses.PENDING,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { _id: false },
);

const customizationPayloadSchema = new mongoose.Schema(
  {
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderItem',
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
      index: true,
    },
    source: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: supportedSources,
    },
    rawRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    rawCustomization: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    rawCustomizationHash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    assets: {
      type: [assetSchema],
      default: [],
    },
    parsedData: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: Object.values(customizationStatuses),
      default: customizationStatuses.PENDING,
      required: true,
      index: true,
    },
    errorCode: {
      type: String,
      trim: true,
      default: null,
    },
    errorMessage: {
      type: String,
      trim: true,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{PATH} must be an integer',
      },
    },
    lastTriedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

customizationPayloadSchema.index({ orderItemId: 1, rawCustomizationHash: 1 }, { unique: true });
customizationPayloadSchema.index({ orderItemId: 1, status: 1 });
customizationPayloadSchema.index({ shopId: 1, status: 1, createdAt: -1 });
customizationPayloadSchema.index({ rawRecordId: 1 });

module.exports = mongoose.model('CustomizationPayload', customizationPayloadSchema);
