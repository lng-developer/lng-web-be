const mongoose = require('mongoose');

const customerLifecycleValues = ['NEW', 'RETURNING', 'VIP', 'AT_RISK', 'ISSUE_PRONE'];
const customerCareStatusValues = ['NONE', 'NEEDS_FOLLOW_UP', 'IN_PROGRESS', 'RESOLVED'];
const customerStatusValues = ['ACTIVE', 'WATCHLIST', 'BLOCKED', 'ARCHIVED'];

const riskFlagSchema = new mongoose.Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  count: { type: Number, default: 0, min: 0 },
  lastSeenAt: { type: Date, default: null },
}, { _id: false });

const shopSnapshotSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, default: null, trim: true },
}, { _id: false });

const projectedOrderSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  externalOrderId: { type: String, default: null, trim: true },
  orderedAt: { type: Date, default: null },
}, { _id: false });

const customerSchema = new mongoose.Schema({
  identityKey: { type: String, required: true, unique: true, index: true },
  salesChannelCode: { type: String, uppercase: true, trim: true, default: null, index: true },
  marketplaceCode: { type: String, uppercase: true, trim: true, default: null, index: true },
  externalBuyerId: { type: String, trim: true, default: null },
  name: { type: String, trim: true, default: null },
  emailMasked: { type: String, trim: true, default: null },
  phoneMasked: { type: String, trim: true, default: null },
  firstOrderId: { type: mongoose.Schema.Types.ObjectId, default: null },
  firstOrderAt: { type: Date, default: null },
  lastOrderId: { type: mongoose.Schema.Types.ObjectId, default: null },
  lastOrderAt: { type: Date, default: null },
  orderCount: { type: Number, default: 0, min: 0 },
  orderItemCount: { type: Number, default: 0, min: 0 },
  totalRevenueAmount: { type: Number, default: 0 },
  totalCostAmount: { type: Number, default: 0 },
  currency: { type: String, uppercase: true, trim: true, default: 'USD' },
  averageOrderValue: { type: Number, default: 0 },
  countries: { type: [String], default: [] },
  shops: { type: [shopSnapshotSchema], default: [] },
  status: { type: String, enum: customerStatusValues, default: 'ACTIVE', index: true },
  lifecycle: { type: String, enum: customerLifecycleValues, default: 'NEW', index: true },
  careStatus: { type: String, enum: customerCareStatusValues, default: 'NONE', index: true },
  riskFlags: { type: [riskFlagSchema], default: [] },
  lastIssueAt: { type: Date, default: null },
  lastCareNoteAt: { type: Date, default: null },
  projectedOrders: { type: [projectedOrderSchema], default: [] },
  searchText: { type: String, trim: true, default: '' },
}, { timestamps: true });

customerSchema.index({ lifecycle: 1, lastOrderAt: -1 });
customerSchema.index({ careStatus: 1, lastIssueAt: -1 });
customerSchema.index({ totalRevenueAmount: -1 });
customerSchema.index({ searchText: 'text' });

module.exports = mongoose.model('Customer', customerSchema);
module.exports.customerLifecycleValues = customerLifecycleValues;
module.exports.customerCareStatusValues = customerCareStatusValues;
module.exports.customerStatusValues = customerStatusValues;
