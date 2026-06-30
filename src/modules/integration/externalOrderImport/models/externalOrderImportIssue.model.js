const mongoose = require('mongoose');
const { externalOrderImportSources } = require('../constants/externalOrderImportSources');
const {
  externalOrderImportIssueSeverities,
  externalOrderImportIssueStatuses,
  externalOrderImportIssueTypes,
} = require('../constants/externalOrderImportIssueTypes');

const integerValidator = {
  validator: (value) => value === null || Number.isInteger(value),
  message: '{PATH} must be an integer',
};

const externalOrderImportIssueSchema = new mongoose.Schema(
  {
    importJobId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    rawRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    source: {
      type: String,
      enum: Object.values(externalOrderImportSources),
      required: true,
      index: true,
    },
    externalOrderId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    externalItemId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    rowNumber: {
      type: Number,
      min: 1,
      default: null,
      validate: integerValidator,
    },
    issueType: {
      type: String,
      enum: Object.values(externalOrderImportIssueTypes),
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: Object.values(externalOrderImportIssueSeverities),
      default: externalOrderImportIssueSeverities.ERROR,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(externalOrderImportIssueStatuses),
      default: externalOrderImportIssueStatuses.OPEN,
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
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

externalOrderImportIssueSchema.index({ status: 1, issueType: 1, createdAt: -1 });
externalOrderImportIssueSchema.index({ importJobId: 1, status: 1 });

module.exports = mongoose.model('ExternalOrderImportIssue', externalOrderImportIssueSchema);
