const mongoose = require('mongoose');
const { financeSourceTypes } = require('../constants/finance.constants');
const { integerAmountField, optionalObjectIdRef } = require('./financeModel.helpers');

const marketplaceFeeLineSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  settlementId: { type: String, trim: true, default: null, index: true },
  marketplaceSettlementId: optionalObjectIdRef('MarketplaceSettlement'),
  orderId: optionalObjectIdRef('Order'),
  orderItemId: optionalObjectIdRef('OrderItem'),
  listingId: optionalObjectIdRef('Listing'),
  externalOrderId: { type: String, trim: true, default: null, index: true },
  externalItemId: { type: String, trim: true, default: null, index: true },
  sku: { type: String, trim: true, default: null, index: true },
  feeType: { type: String, required: true, trim: true, uppercase: true, index: true },
  feeCategory: { type: String, trim: true, uppercase: true, default: null, index: true },
  description: { type: String, trim: true, default: null },
  feeAmount: integerAmountField(),
  taxAmount: integerAmountField(),
  totalFeeAmount: integerAmountField(),
  currency: { type: String, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'USD' },
  postedAt: { type: Date, default: null, index: true },
  sourceType: {
    type: String,
    enum: Object.values(financeSourceTypes),
    default: financeSourceTypes.IMPORT,
    index: true,
  },
  sourceRef: { type: String, trim: true, default: null, index: true },
  importBatchId: optionalObjectIdRef('FinanceImportBatch'),
  rawReference: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

marketplaceFeeLineSchema.index({ orderId: 1, feeType: 1 });
marketplaceFeeLineSchema.index({ orderItemId: 1, feeType: 1 });
marketplaceFeeLineSchema.index({ shopId: 1, salesChannelCode: 1, marketplaceCode: 1, externalOrderId: 1, sku: 1 });
marketplaceFeeLineSchema.index(
  { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, sourceRef: 1, 'rawReference.importKey': 1 },
  {
    name: 'finance_fee_line_import_identity_idx',
    unique: true,
    partialFilterExpression: {
      sourceRef: { $type: 'string' },
      'rawReference.importKey': { $type: 'string' },
    },
  },
);

module.exports = mongoose.model('MarketplaceFeeLine', marketplaceFeeLineSchema);
