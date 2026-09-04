const mongoose = require('mongoose');

const compactItemSchema = new mongoose.Schema({
  orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  item: { type: mongoose.Schema.Types.Mixed, required: true },
  seller: { type: mongoose.Schema.Types.Mixed, default: null },
  listing: { type: mongoose.Schema.Types.Mixed, default: null },
  customization: { type: mongoose.Schema.Types.Mixed, default: null },
  fulfillmentPlan: { type: mongoose.Schema.Types.Mixed, default: null },
  listingVariant: { type: mongoose.Schema.Types.Mixed, default: null },
  production: { type: mongoose.Schema.Types.Mixed, default: null },
  tracking: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const orderWorkbenchProjectionSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  externalOrderId: { type: String, required: true, index: true },
  salesChannelCode: { type: String, default: null },
  marketplaceCode: { type: String, default: null },
  externalAccountId: { type: String, default: null },
  assignedStaffIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  sourceCreatedAt: { type: Date, default: null },
  sourceUpdatedAt: { type: Date, default: null },
  orderedAt: { type: Date, default: null },
  shipByDate: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  status: { type: String, default: null },
  costCenterStatus: { type: String, default: null },
  psdStatus: { type: String, default: null },
  hasCurrentPsd: { type: Boolean, default: false },
  paymentStatus: { type: String, default: null },
  addressValidationStatus: { type: String, default: null },
  caseStatus: { type: String, default: null },
  order: { type: mongoose.Schema.Types.Mixed, required: true },
  shop: { type: mongoose.Schema.Types.Mixed, default: null },
  case: { type: mongoose.Schema.Types.Mixed, default: null },
  items: { type: [compactItemSchema], default: [] },
}, { timestamps: true });

orderWorkbenchProjectionSchema.index({ shopId: 1, orderedAt: -1, _id: -1 });
orderWorkbenchProjectionSchema.index({ orderedAt: -1, _id: -1 });
orderWorkbenchProjectionSchema.index({ shopId: 1, status: 1, orderedAt: -1, _id: -1 });
orderWorkbenchProjectionSchema.index({ shopId: 1, caseStatus: 1, orderedAt: -1, _id: -1 });

module.exports = mongoose.model('OrderWorkbenchProjection', orderWorkbenchProjectionSchema);
