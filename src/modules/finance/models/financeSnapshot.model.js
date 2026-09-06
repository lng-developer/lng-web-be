const mongoose = require('mongoose');
const {
  financeCostStatuses,
  financeSnapshotStatuses,
  marketplaceFeeSources,
} = require('../constants/finance.constants');

const integerValidator = {
  validator: (value) => value === null || value === undefined || Number.isInteger(value),
  message: '{PATH} must be an integer',
};

const moneyField = {
  type: Number,
  default: 0,
  validate: integerValidator,
};

const nullableMoneyField = {
  type: Number,
  default: null,
  validate: integerValidator,
};

const costLineSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  label: { type: String, trim: true, default: null },
  amount: { type: Number, required: true, validate: integerValidator },
}, { _id: false });

const calculationHistorySchema = new mongoose.Schema({
  calculatedAt: { type: Date, required: true },
  snapshotStatus: { type: String, enum: Object.values(financeSnapshotStatuses), required: true },
  costStatus: { type: String, enum: Object.values(financeCostStatuses), required: true },
  missingCostReason: { type: String, trim: true, uppercase: true, default: null },
}, { _id: false });

const financeSnapshotSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true },
  salesChannelCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  marketplaceCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  fulfillmentPlanId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  vendorProductId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  vendorCostCenterId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  shipmentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  sellerEmployeeCode: { type: String, trim: true, uppercase: true, default: null },
  sellerAccountId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  sellerName: { type: String, trim: true, default: null },
  teamId: { type: mongoose.Schema.Types.ObjectId, default: null },
  teamName: { type: String, trim: true, default: null },
  teamCode: { type: String, trim: true, uppercase: true, default: null },
  departmentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  departmentName: { type: String, trim: true, default: null },
  departmentCode: { type: String, trim: true, uppercase: true, default: null },
  itemPriceAmount: moneyField,
  taxAmount: moneyField,
  shippingAmount: moneyField,
  giftWrapAmount: moneyField,
  discountAmount: moneyField,
  feeAmount: moneyField,
  feeSource: { type: String, enum: Object.values(marketplaceFeeSources), default: null },
  refundAmount: moneyField,
  customerPaidAmount: moneyField,
  currency: { type: String, trim: true, uppercase: true, minlength: 3, maxlength: 3, default: 'USD' },
  baseCostAmount: nullableMoneyField,
  totalCostAmount: nullableMoneyField,
  costLines: { type: [costLineSchema], default: [] },
  costStatus: {
    type: String,
    enum: Object.values(financeCostStatuses),
    required: true,
    default: financeCostStatuses.MISSING,
    index: true,
  },
  missingCostReason: { type: String, trim: true, uppercase: true, default: null },
  calculationHistory: { type: [calculationHistorySchema], default: [] },
  grossProfitAmount: nullableMoneyField,
  grossMarginBps: nullableMoneyField,
  snapshotStatus: {
    type: String,
    enum: Object.values(financeSnapshotStatuses),
    required: true,
    default: financeSnapshotStatuses.MISSING_COST,
    index: true,
  },
  calculatedAt: { type: Date, required: true, default: Date.now, index: true },
}, { timestamps: true });

financeSnapshotSchema.index({ shopId: 1, calculatedAt: -1 });
financeSnapshotSchema.index({ orderId: 1, calculatedAt: -1 });
financeSnapshotSchema.index({ sellerEmployeeCode: 1, calculatedAt: -1 });
financeSnapshotSchema.index({ teamId: 1, calculatedAt: -1 });

module.exports = mongoose.model('FinanceSnapshot', financeSnapshotSchema);
