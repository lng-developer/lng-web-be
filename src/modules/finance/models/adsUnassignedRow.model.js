const mongoose = require('mongoose');

const adsUnassignedRowSchema = new mongoose.Schema({
  sourceRef: { type: String, required: true, trim: true, index: true },
  reportDate: { type: Date, required: true, index: true },
  advertiserAccountId: { type: String, required: true, trim: true, index: true },
  campaignId: { type: String, default: null, trim: true },
  campaignName: { type: String, default: null, trim: true },
  portfolioId: { type: String, default: null, trim: true },
  portfolioName: { type: String, default: null, trim: true },
  salesChannelCode: { type: String, required: true, trim: true, uppercase: true },
  marketplaceCode: { type: String, required: true, trim: true, uppercase: true },
  status: { type: String, enum: ['PENDING', 'RESOLVED'], default: 'PENDING', index: true },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

adsUnassignedRowSchema.index(
  { sourceRef: 1, reportDate: 1, advertiserAccountId: 1, campaignId: 1, portfolioId: 1 },
  { unique: true },
);

module.exports = mongoose.model('AdsUnassignedRow', adsUnassignedRowSchema);
