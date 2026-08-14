const mongoose = require('mongoose');
const {
  productionBlockers,
  productionCsStatuses,
  productionQcStatuses,
  productionScaleStatuses,
  productionSourceTypes,
  productionTaskStatuses,
} = require('../constants/production.constants');

const productionFileCheckSchema = new mongoose.Schema(
  {
    slotKey: { type: String, required: true, trim: true },
    slotLabel: { type: String, trim: true, default: null },
    required: { type: Boolean, default: true },
    sourceType: {
      type: String,
      enum: Object.values(productionSourceTypes),
      required: true,
    },
    inputAssetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    inputSourceLabel: { type: String, trim: true, default: null },
    inputSlotKey: { type: String, trim: true, default: null },
    inputImageName: { type: String, trim: true, default: null },
    outputAssetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    outputWorkerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    scaleStatus: {
      type: String,
      enum: Object.values(productionScaleStatuses),
      default: productionScaleStatuses.NEED_SCALE,
    },
    qcStatus: {
      type: String,
      enum: Object.values(productionQcStatuses),
      default: productionQcStatuses.NOT_READY,
    },
    blockers: {
      type: [String],
      enum: Object.values(productionBlockers),
      default: [],
    },
    note: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

const snapshotRefSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    code: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    status: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const orderItemSnapshotSchema = new mongoose.Schema(
  {
    externalOrderId: { type: String, trim: true, default: null },
    externalItemId: { type: String, trim: true, default: null },
    externalAccountId: { type: String, trim: true, default: null },
    salesChannelCode: { type: String, trim: true, uppercase: true, default: null },
    marketplaceCode: { type: String, trim: true, uppercase: true, default: null },
    asin: { type: String, trim: true, default: null },
    sku: { type: String, trim: true, default: null },
    title: { type: String, trim: true, default: null },
    productImageUrl: { type: String, trim: true, default: null },
  },
  { _id: false, strict: false },
);

const orderSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    status: { type: String, trim: true, default: null },
    assignedStaffId: { type: String, default: null },
    externalAccountId: { type: String, trim: true, default: null },
    orderedAt: { type: Date, default: null },
    shipByDate: { type: Date, default: null },
    addressValidationStatus: { type: String, trim: true, default: null },
    shippingAddress: { type: mongoose.Schema.Types.Mixed, default: null },
    shippingService: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: false },
);

const listingSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    sku: { type: String, trim: true, default: null },
    asin: { type: String, trim: true, default: null },
    title: { type: String, trim: true, default: null },
    printMethod: { type: String, trim: true, uppercase: true, default: null },
    productTypeGroupId: { type: snapshotRefSchema, default: null },
    psdTemplateAssetId: { type: String, default: null },
    psdStatus: { type: String, trim: true, default: null },
    scaleDifficulty: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: false },
);

const templateSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    code: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    productTypeGroupId: { type: snapshotRefSchema, default: null },
    artworkSlots: { type: [mongoose.Schema.Types.Mixed], default: [] },
    designAssets: { type: [mongoose.Schema.Types.Mixed], default: [] },
    requiredFields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, trim: true, default: null },
  },
  { _id: false, strict: false },
);

const customizationAssetSnapshotSchema = new mongoose.Schema(
  {
    assetId: { type: String, default: null },
    filename: { type: String, trim: true, default: null },
    mimeType: { type: String, trim: true, default: null },
    size: { type: Number, default: null },
  },
  { _id: false, strict: false },
);

const customizationSnapshotSchema = new mongoose.Schema(
  {
    payloadId: { type: String, default: null },
    status: { type: String, trim: true, default: null },
    needsReview: { type: Boolean, default: false },
    customerInputs: { type: mongoose.Schema.Types.Mixed, default: null },
    imageAssets: { type: [customizationAssetSnapshotSchema], default: [] },
    failedImages: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: false, strict: false },
);

const vendorProductSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    code: { type: String, trim: true, default: null },
    name: { type: String, trim: true, default: null },
    vendor: { type: mongoose.Schema.Types.Mixed, default: null },
    baseCostAmount: { type: Number, default: null },
    currency: { type: String, trim: true, default: null },
  },
  { _id: false, strict: false },
);

const vendorCostCenterSnapshotSchema = new mongoose.Schema(
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
    currency: { type: String, trim: true, default: null },
  },
  { _id: false, strict: false },
);

const productionTaskSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    fulfillmentPlanId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    listingVariantId: { type: mongoose.Schema.Types.ObjectId, ref: 'ListingVariant', default: null, index: true },
    orderSnapshot: { type: orderSnapshotSchema, default: null },
    orderItemSnapshot: { type: orderItemSnapshotSchema, default: null },
    listingSnapshot: { type: listingSnapshotSchema, default: null },
    templateSnapshot: { type: templateSnapshotSchema, default: null },
    vendorProductSnapshot: { type: vendorProductSnapshotSchema, default: null },
    vendorCostCenterSnapshot: { type: vendorCostCenterSnapshotSchema, default: null },
    customizationSnapshot: { type: customizationSnapshotSchema, default: null },
    fulfillQty: {
      type: Number,
      min: 1,
      default: 1,
      validate: {
        validator: Number.isInteger,
        message: 'fulfillQty must be an integer',
      },
    },
    status: {
      type: String,
      enum: Object.values(productionTaskStatuses),
      required: true,
      default: productionTaskStatuses.BLOCKED,
      index: true,
    },
    scaleStatus: {
      type: String,
      enum: Object.values(productionScaleStatuses),
      default: productionScaleStatuses.NEED_SCALE,
      index: true,
    },
    qcStatus: {
      type: String,
      enum: Object.values(productionQcStatuses),
      default: productionQcStatuses.NOT_READY,
      index: true,
    },
    blockers: {
      type: [String],
      enum: Object.values(productionBlockers),
      default: [],
    },
    fileChecks: {
      type: [productionFileCheckSchema],
      default: [],
    },
    assignedDesignUserId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    assignedAt: { type: Date, default: null },
    designNote: { type: String, trim: true, default: null },
    csAssigneeId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    csAssignedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    csAssignedAt: { type: Date, default: null },
    csStatus: {
      type: String,
      enum: Object.values(productionCsStatuses),
      default: productionCsStatuses.UNASSIGNED,
      index: true,
    },
    csNote: { type: String, trim: true, default: null },
    qcBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    qcAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    sentToVendorAt: { type: Date, default: null },
    vendorSubmissionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

productionTaskSchema.index({ shopId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('ProductionTask', productionTaskSchema);
