const mongoose = require('mongoose');
const {
  externalOrderImportSources,
  externalOrderImportSourceTypes,
} = require('../constants/externalOrderImportSources');
const {
  externalOrderImportJobStatuses,
} = require('../constants/externalOrderImportStatuses');

const integerValidator = {
  validator: Number.isInteger,
  message: '{PATH} must be an integer',
};

function counterField() {
  return {
    type: Number,
    min: 0,
    default: 0,
    validate: integerValidator,
  };
}

const externalOrderImportJobSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: Object.values(externalOrderImportSources),
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: Object.values(externalOrderImportSourceTypes),
      required: true,
      index: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    shopConnectionId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    salesChannelCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'AMAZON',
    },
    marketplaceCode: {
      type: String,
      uppercase: true,
      trim: true,
      required: true,
    },
    externalAccountId: {
      type: String,
      trim: true,
      default: null,
    },
    sourceFileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    extensionAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    extensionCommandId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(externalOrderImportJobStatuses),
      default: externalOrderImportJobStatuses.PENDING,
      index: true,
    },
    totalRecords: counterField(),
    parsedCount: counterField(),
    importedCount: counterField(),
    skippedCount: counterField(),
    failedCount: counterField(),
    startedAt: {
      type: Date,
      default: null,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
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

externalOrderImportJobSchema.index({ source: 1, status: 1, createdAt: -1 });
externalOrderImportJobSchema.index({ shopId: 1, status: 1, createdAt: -1 });
externalOrderImportJobSchema.index({ sourceFileId: 1 });

module.exports = mongoose.model('ExternalOrderImportJob', externalOrderImportJobSchema);
