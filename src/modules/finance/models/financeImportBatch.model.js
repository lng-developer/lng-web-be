const mongoose = require('mongoose');

const financeImportBatchSourceTypes = ['TRANSACTIONS', 'SETTLEMENTS', 'ADS'];
const financeImportBatchStatuses = ['PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED'];

const financeImportBatchSchema = new mongoose.Schema({
  sourceType: { type: String, enum: financeImportBatchSourceTypes, required: true, index: true },
  sourceAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', required: true, index: true },
  originalFilename: { type: String, required: true, trim: true },
  sourceRef: { type: String, required: true, trim: true },
  dryRun: { type: Boolean, default: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null, index: true },
  status: { type: String, enum: financeImportBatchStatuses, required: true, index: true },
  processedRows: { type: Number, default: 0, min: 0 },
  validRows: { type: Number, default: 0, min: 0 },
  skippedRows: { type: Number, default: 0, min: 0 },
  unlinkedRows: { type: Number, default: 0, min: 0 },
  upserted: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  errorCount: { type: Number, default: 0, min: 0 },
  errors: [{ row: { type: String, default: null }, message: { type: String, required: true } }],
  finishedAt: { type: Date, default: null },
}, { timestamps: true, suppressReservedKeysWarning: true });

financeImportBatchSchema.index({ shopId: 1, createdAt: -1 });
financeImportBatchSchema.index({ sourceAssetId: 1, createdAt: -1 });

module.exports = mongoose.model('FinanceImportBatch', financeImportBatchSchema);
