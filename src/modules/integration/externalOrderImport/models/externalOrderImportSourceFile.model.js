const mongoose = require('mongoose');
const { externalOrderImportSources } = require('../constants/externalOrderImportSources');

const externalOrderImportSourceFileSchema = new mongoose.Schema(
  {
    importJobId: {
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
    assetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    originalFilename: {
      type: String,
      trim: true,
      default: null,
    },
    mimeType: {
      type: String,
      trim: true,
      default: null,
    },
    fileHash: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    reportId: {
      type: String,
      trim: true,
      default: null,
    },
    reportSignature: {
      type: String,
      trim: true,
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true },
);

externalOrderImportSourceFileSchema.index({ source: 1, fileHash: 1 });
externalOrderImportSourceFileSchema.index({ assetId: 1 });

module.exports = mongoose.model('ExternalOrderImportSourceFile', externalOrderImportSourceFileSchema);
