const mongoose = require('mongoose');
const { financeSourceTypes } = require('../constants/finance.constants');
const { integerAmountField, optionalObjectIdRef } = require('./financeModel.helpers');

const refundRecordSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  orderId: optionalObjectIdRef('Order'),
  orderItemId: optionalObjectIdRef('OrderItem'),
  listingId: optionalObjectIdRef('Listing'),
  externalOrderId: { type: String, trim: true, default: null, index: true },
  externalItemId: { type: String, trim: true, default: null, index: true },
  sku: { type: String, trim: true, default: null, index: true },
  externalRefundId: { type: String, trim: true, default: null, index: true },
  refundType: { type: String, trim: true, uppercase: true, default: 'REFUND', index: true },
  reasonCode: { type: String, trim: true, default: null },
  refundAmount: integerAmountField({ min: 0 }),
  shippingRefundAmount: integerAmountField({ min: 0 }),
  taxRefundAmount: integerAmountField({ min: 0 }),
  adjustmentRefundAmount: integerAmountField({ min: 0 }),
  totalRefundAmount: integerAmountField({ min: 0 }),
  currency: { type: String, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'USD' },
  refundedAt: { type: Date, required: true, index: true },
  sourceType: {
    type: String,
    enum: Object.values(financeSourceTypes),
    default: financeSourceTypes.IMPORT,
    index: true,
  },
  sourceRef: { type: String, trim: true, default: null, index: true },
  rawReference: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

refundRecordSchema.index({ orderId: 1, refundedAt: -1 });
refundRecordSchema.index({ orderItemId: 1, refundedAt: -1 });
refundRecordSchema.index({ shopId: 1, salesChannelCode: 1, marketplaceCode: 1, refundedAt: -1 });
refundRecordSchema.index({ shopId: 1, salesChannelCode: 1, marketplaceCode: 1, externalOrderId: 1, sku: 1 });
refundRecordSchema.index(
  { shopId: 1, salesChannelCode: 1, marketplaceCode: 1, externalRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalRefundId: { $type: 'string' },
    },
  },
);

module.exports = mongoose.model('RefundRecord', refundRecordSchema);
