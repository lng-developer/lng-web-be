const mongoose = require('mongoose');
const { financeSourceTypes } = require('../constants/finance.constants');
const { integerAmountField, optionalObjectIdRef } = require('./financeModel.helpers');

const marketplaceSettlementLedgerLineSchema = new mongoose.Schema({
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
  transactionType: { type: String, trim: true, default: null, index: true },
  transactionStatus: { type: String, trim: true, default: null, index: true },
  amountType: { type: String, trim: true, default: null, index: true },
  amountDescription: { type: String, trim: true, default: null, index: true },
  ledgerCategory: { type: String, trim: true, uppercase: true, default: 'SETTLEMENT_ACTIVITY', index: true },
  amount: integerAmountField(),
  currency: { type: String, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'USD' },
  quantityPurchased: { type: Number, default: null },
  postedAt: { type: Date, default: null, index: true },
  sourceType: {
    type: String,
    enum: Object.values(financeSourceTypes),
    default: financeSourceTypes.IMPORT,
    index: true,
  },
  sourceRef: { type: String, trim: true, default: null, index: true },
  rawReference: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

marketplaceSettlementLedgerLineSchema.index({ shopId: 1, salesChannelCode: 1, marketplaceCode: 1, postedAt: -1 });
marketplaceSettlementLedgerLineSchema.index({ orderId: 1, postedAt: -1 });
marketplaceSettlementLedgerLineSchema.index({ orderItemId: 1, postedAt: -1 });
marketplaceSettlementLedgerLineSchema.index(
  { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, sourceRef: 1, 'rawReference.importKey': 1 },
  {
    name: 'finance_settlement_ledger_import_identity_idx',
    unique: true,
    partialFilterExpression: {
      sourceRef: { $type: 'string' },
      'rawReference.importKey': { $type: 'string' },
    },
  },
);

module.exports = mongoose.model('MarketplaceSettlementLedgerLine', marketplaceSettlementLedgerLineSchema);
