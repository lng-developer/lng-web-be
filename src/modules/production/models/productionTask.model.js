const mongoose = require('mongoose');
const {
  productionBlockers,
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
    outputAssetId: { type: mongoose.Schema.Types.ObjectId, default: null },
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

const productionTaskSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    fulfillmentPlanId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderItemSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    listingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    templateSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    customizationSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    vendorProductSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    vendorCostCenterSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
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
