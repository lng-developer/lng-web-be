const mongoose = require('mongoose');
const {
  fulfillmentPlanSelectionModes,
  fulfillmentPlanStatuses,
} = require('../constants/fulfillmentPlan.constants');

const snapshotRefSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    code: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    status: { type: String, trim: true, default: null },
  },
  { _id: false, strict: false },
);

const planOrderItemSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    externalOrderId: { type: String, trim: true, default: null },
    externalItemId: { type: String, trim: true, default: null },
    sku: { type: String, trim: true, default: null },
    title: { type: String, trim: true, default: null },
    quantity: { type: Number, default: null },
  },
  { _id: false, strict: false },
);

const planListingSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    sku: { type: String, trim: true, default: null },
    title: { type: String, trim: true, default: null },
    productTypeGroupId: { type: String, default: null },
    internalTemplateId: { type: String, default: null },
    printMethod: { type: String, trim: true, uppercase: true, default: null },
  },
  { _id: false, strict: false },
);

const planVendorSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    code: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    status: { type: String, trim: true, default: null },
  },
  { _id: false, strict: false },
);

const planVendorProductSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    code: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    vendor: { type: planVendorSnapshotSchema, default: null },
    baseCostAmount: { type: Number, default: null },
    currency: { type: String, trim: true, uppercase: true, default: null },
  },
  { _id: false, strict: false },
);

const costEstimateLineSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, default: null },
    label: { type: String, trim: true, default: null },
    amount: { type: Number, default: 0 },
  },
  { _id: false, strict: false },
);

const costEstimateSchema = new mongoose.Schema(
  {
    currency: { type: String, trim: true, uppercase: true, default: null },
    totalAmount: { type: Number, default: 0 },
    lines: { type: [costEstimateLineSchema], default: [] },
    signals: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: false, strict: false },
);

const planVendorCostCenterSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    vendorProductId: { type: String, default: null },
    code: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    sku: { type: String, trim: true, default: null },
    lngCode: { type: String, trim: true, default: null },
    standardSize: { type: String, trim: true, default: null },
    standardColor: { type: String, trim: true, default: null },
    printMethod: { type: String, trim: true, uppercase: true, default: null },
    baseCostAmount: { type: Number, default: null },
    currency: { type: String, trim: true, uppercase: true, default: null },
    matchScore: { type: Number, default: 0 },
    matchReasons: { type: [String], default: [] },
    confidence: { type: String, trim: true, default: null },
    routingSpecificity: { type: Number, default: 0 },
    routingPriority: { type: Number, default: null },
    costEstimate: { type: costEstimateSchema, default: null },
  },
  { _id: false, strict: false },
);

const fulfillmentPlanSnapshotSchema = new mongoose.Schema(
  {
    orderItem: { type: planOrderItemSnapshotSchema, default: null },
    listing: { type: planListingSnapshotSchema, default: null },
    internalTemplate: { type: snapshotRefSchema, default: null },
    vendor: { type: planVendorSnapshotSchema, default: null },
    vendorProduct: { type: planVendorProductSnapshotSchema, default: null },
    vendorCostCenter: { type: planVendorCostCenterSnapshotSchema, default: null },
    costEstimate: { type: costEstimateSchema, default: null },
  },
  { _id: false, strict: false },
);

const fulfillmentPlanSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    listingId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    listingVariantId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
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
    snapshot: { type: fulfillmentPlanSnapshotSchema, default: () => ({}) },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

fulfillmentPlanSchema.index({ orderItemId: 1 }, { unique: true });

module.exports = mongoose.model('FulfillmentPlan', fulfillmentPlanSchema);
