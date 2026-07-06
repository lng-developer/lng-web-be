const mongoose = require('mongoose');
const {
  fulfillmentPlanSelectionModes,
  fulfillmentPlanStatuses,
} = require('../constants/fulfillmentPlan.constants');

const fulfillmentPlanSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    listingId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    internalTemplateId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    productTypeGroupId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    vendorProductId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    vendorCostCenterId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    status: {
      type: String,
      enum: Object.values(fulfillmentPlanStatuses),
      required: true,
      default: fulfillmentPlanStatuses.READY,
      index: true,
    },
    selectionMode: {
      type: String,
      enum: Object.values(fulfillmentPlanSelectionModes),
      default: null,
      index: true,
    },
    blockingReasons: { type: [String], default: [] },
    checks: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

fulfillmentPlanSchema.index({ orderItemId: 1 }, { unique: true });

module.exports = mongoose.model('FulfillmentPlan', fulfillmentPlanSchema);
