const mongoose = require('mongoose');
const { financeSourceTypes } = require('../constants/finance.constants');
const { integerAmountField, optionalObjectIdRef } = require('./financeModel.helpers');

const adsSpendDailySchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  reportDate: { type: Date, required: true, index: true },
  portfolioName: { type: String, trim: true, default: null, index: true },
  sellerEmployeeCode: { type: String, trim: true, uppercase: true, default: null, index: true },
  sellerAttributionSource: {
    type: String,
    enum: ['PORTFOLIO_NAME', 'CAMPAIGN_NAME', 'UNASSIGNED'],
    default: 'UNASSIGNED',
  },
  programType: { type: String, trim: true, default: null, index: true },
  campaignName: { type: String, required: true, trim: true, index: true },
  retailer: { type: String, trim: true, default: null },
  country: { type: String, trim: true, default: null },
  status: { type: String, trim: true, uppercase: true, default: null, index: true },
  currency: { type: String, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'USD' },
  budgetAmount: integerAmountField({ min: 0 }),
  spendAmount: integerAmountField({ min: 0 }),
  attributedSalesAmount: integerAmountField({ min: 0 }),
  impressions: { type: Number, default: 0, min: 0 },
  clicks: { type: Number, default: 0, min: 0 },
  orders7d: { type: Number, default: 0, min: 0 },
  ctrBps: { type: Number, default: 0, min: 0 },
  acosBps: { type: Number, default: 0, min: 0 },
  roasBps: { type: Number, default: 0, min: 0 },
  cpcAmount: integerAmountField({ min: 0 }),
  listingId: optionalObjectIdRef('Listing'),
  sourceType: {
    type: String,
    enum: Object.values(financeSourceTypes),
    default: financeSourceTypes.IMPORT,
    index: true,
  },
  sourceRef: { type: String, trim: true, default: null, index: true },
  rawReference: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

adsSpendDailySchema.index({ shopId: 1, salesChannelCode: 1, marketplaceCode: 1, reportDate: -1 });
adsSpendDailySchema.index({ shopId: 1, campaignName: 1, reportDate: -1 });
adsSpendDailySchema.index(
  { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, reportDate: 1, campaignName: 1 },
  { unique: true, partialFilterExpression: { campaignName: { $type: 'string' } } },
);

module.exports = mongoose.model('AdsSpendDaily', adsSpendDailySchema);
