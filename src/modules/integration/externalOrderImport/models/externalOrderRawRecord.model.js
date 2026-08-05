const mongoose = require('mongoose');
const { externalOrderImportSources } = require('../constants/externalOrderImportSources');
const {
  externalOrderPostImportStatuses,
  externalOrderRawRecordImportStatuses,
  externalOrderRawRecordNormalizeStatuses,
} = require('../constants/externalOrderImportStatuses');

const integerValidator = {
  validator: Number.isInteger,
  message: '{PATH} must be an integer',
};

const externalOrderRawRecordSchema = new mongoose.Schema(
  {
    importJobId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: Object.values(externalOrderImportSources),
      required: true,
      index: true,
    },
    rowNumber: {
      type: Number,
      required: true,
      min: 1,
      validate: integerValidator,
    },
    externalOrderId: {
      type: String,
      trim: true,
      default: null,
    },
    externalItemId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    asin: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    sku: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    rawRecord: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    rawRecordHash: {
      type: String,
      required: true,
      trim: true,
    },
    normalizeStatus: {
      type: String,
      enum: Object.values(externalOrderRawRecordNormalizeStatuses),
      default: externalOrderRawRecordNormalizeStatuses.PENDING,
      index: true,
    },
    importStatus: {
      type: String,
      enum: Object.values(externalOrderRawRecordImportStatuses),
      default: externalOrderRawRecordImportStatuses.PENDING,
      index: true,
    },
    postImportStatus: {
      type: String,
      enum: Object.values(externalOrderPostImportStatuses),
      default: externalOrderPostImportStatuses.PENDING,
      index: true,
    },
    postImportAttempts: {
      type: Number,
      default: 0,
      min: 0,
      validate: integerValidator,
    },
    postImportQueuedAt: {
      type: Date,
      default: null,
    },
    postImportStartedAt: {
      type: Date,
      default: null,
    },
    postImportFinishedAt: {
      type: Date,
      default: null,
    },
    postImportErrorCode: {
      type: String,
      trim: true,
      default: null,
    },
    postImportErrorMessage: {
      type: String,
      trim: true,
      default: null,
    },
    postImportLeaseToken: {
      type: String,
      trim: true,
      default: null,
    },
    postImportLeaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
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
  },
  { timestamps: true },
);

externalOrderRawRecordSchema.index({ importJobId: 1, rowNumber: 1 }, { unique: true });
externalOrderRawRecordSchema.index({ importJobId: 1, importStatus: 1 });
externalOrderRawRecordSchema.index({ importJobId: 1, postImportStatus: 1 });
externalOrderRawRecordSchema.index({ postImportStatus: 1, postImportLeaseExpiresAt: 1 });
externalOrderRawRecordSchema.index({ externalOrderId: 1 });
externalOrderRawRecordSchema.index({ rawRecordHash: 1 });
externalOrderRawRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('ExternalOrderRawRecord', externalOrderRawRecordSchema);
