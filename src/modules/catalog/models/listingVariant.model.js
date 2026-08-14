const mongoose = require('mongoose');
const { recordStatuses } = require('../constants/catalog.constants');
const { printMethodValues } = require('../../../shared/constants/printMethods');

const listingVariantSchema = new mongoose.Schema({
  listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
  productTypeGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductTypeGroup', required: true, index: true },
  internalTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'InternalTemplate', default: null },
  psdTemplateAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', default: null },
  previewAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', default: null },
  printMethod: { type: String, enum: printMethodValues, uppercase: true, trim: true, default: null, index: true },
  scaleDifficulty: {
    level: { type: String, enum: ['NORMAL', 'HARD', 'SPECIAL'], default: 'NORMAL' },
    reason: { type: String, trim: true, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    updatedAt: { type: Date, default: null },
  },
  status: { type: String, enum: Object.values(recordStatuses), default: recordStatuses.ACTIVE, index: true },
}, { timestamps: true });

listingVariantSchema.index({ listingId: 1, productTypeGroupId: 1 }, { unique: true });

module.exports = mongoose.model('ListingVariant', listingVariantSchema);
