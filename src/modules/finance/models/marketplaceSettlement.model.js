const mongoose = require('mongoose');
const { financeSourceTypes } = require('../constants/finance.constants');
const { integerAmountField } = require('./financeModel.helpers');

const marketplaceSettlementSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  settlementId: { type: String, required: true, trim: true, index: true },
  periodStartAt: { type: Date, default: null, index: true },
  periodEndAt: { type: Date, default: null, index: true },
  depositAt: { type: Date, default: null, index: true },
  currency: { type: String, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'USD' },
  totalAmount: integerAmountField(),
  grossSalesAmount: integerAmountField(),
  refundAmount: integerAmountField(),
  feeAmount: integerAmountField(),
  advertisingCostAmount: integerAmountField(),
  netSettlementAmount: integerAmountField(),
  lineCount: { type: Number, default: 0, min: 0 },
  sourceType: {
    type: String,
    enum: Object.values(financeSourceTypes),
    default: financeSourceTypes.IMPORT,
    index: true,
  },
  sourceRef: { type: String, trim: true, default: null, index: true },
  rawReference: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

marketplaceSettlementSchema.index(
  { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, settlementId: 1 },
  { unique: true },
);
marketplaceSettlementSchema.index({ shopId: 1, depositAt: -1 });

module.exports = mongoose.model('MarketplaceSettlement', marketplaceSettlementSchema);
