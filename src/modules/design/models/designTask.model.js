const mongoose = require('mongoose');
const {
  activeDesignTaskStatuses,
  designTaskPriorities,
  designTaskSubmissionStatuses,
  designTaskStatuses,
  designTaskOutputTypes,
  designTaskTypes,
} = require('../constants/design.constants');

const { Schema } = mongoose;

const designListingSnapshotSchema = new Schema({
  id: {
    type: String,
    default: null,
  },
  shopId: {
    type: String,
    default: null,
  },
  sku: {
    type: String,
    trim: true,
    default: null,
  },
  title: {
    type: String,
    trim: true,
    default: null,
  },
  asin: {
    type: String,
    trim: true,
    default: null,
  },
  etsyListingId: {
    type: String,
    trim: true,
    default: null,
  },
  productTypeGroupId: {
    type: String,
    default: null,
  },
  internalTemplateId: {
    type: String,
    default: null,
  },
  psdStatus: {
    type: String,
    trim: true,
    default: null,
  },
}, { _id: false, strict: false });

const designInternalTemplateSnapshotSchema = new Schema({
  id: {
    type: String,
    default: null,
  },
  code: {
    type: String,
    trim: true,
    default: null,
  },
  name: {
    type: String,
    trim: true,
    default: null,
  },
  status: {
    type: String,
    trim: true,
    default: null,
  },
}, { _id: false, strict: false });

const designTaskSubmissionSchema = new Schema({
  version: {
    type: Number,
    required: true,
    min: 1,
  },
  assetIds: [{
    type: Schema.Types.ObjectId,
    ref: 'MediaAsset',
  }],
  submittedBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  submittedAt: {
    type: Date,
    default: null,
  },
  note: {
    type: String,
    trim: true,
    default: null,
  },
  status: {
    type: String,
    enum: Object.values(designTaskSubmissionStatuses),
    required: true,
  },
  approvedAssetId: {
    type: Schema.Types.ObjectId,
    ref: 'MediaAsset',
    default: null,
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  rejectedBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
  },
  rejectReason: {
    type: String,
    trim: true,
    default: null,
  },
  removedBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  removedAt: {
    type: Date,
    default: null,
  },
}, { _id: true });

const designTaskSchema = new Schema({
  listingId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Listing',
    index: true,
  },
  listingVariantId: {
    type: Schema.Types.ObjectId,
    ref: 'ListingVariant',
    default: null,
    index: true,
  },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  orderItemId: { type: Schema.Types.ObjectId, ref: 'OrderItem', default: null, index: true },
  requestedByAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null, index: true },
  requestNote: { type: String, trim: true, default: null },
  shopId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Shop',
    index: true,
  },
  productTypeGroupId: {
    type: Schema.Types.ObjectId,
    ref: 'ProductTypeGroup',
    default: null,
  },
  internalTemplateId: {
    type: Schema.Types.ObjectId,
    ref: 'InternalTemplate',
    default: null,
  },
  targetListingId: {
    type: Schema.Types.ObjectId,
    ref: 'Listing',
    default: null,
    index: true,
  },
  sourceListingId: {
    type: Schema.Types.ObjectId,
    ref: 'Listing',
    default: null,
    index: true,
  },
  sourceInternalTemplateId: {
    type: Schema.Types.ObjectId,
    ref: 'InternalTemplate',
    default: null,
    index: true,
  },
  taskType: {
    type: String,
    enum: Object.values(designTaskTypes),
    required: true,
    index: true,
  },
  brief: {
    type: String,
    trim: true,
    default: null,
  },
  referenceAssetIds: [{
    type: Schema.Types.ObjectId,
    ref: 'MediaAsset',
  }],
  expectedOutputs: [{
    type: String,
    enum: Object.values(designTaskOutputTypes),
  }],
  priority: {
    type: String,
    enum: Object.values(designTaskPriorities),
    default: designTaskPriorities.NORMAL,
    index: true,
  },
  status: {
    type: String,
    enum: Object.values(designTaskStatuses),
    default: designTaskStatuses.REQUESTED,
    index: true,
  },
  listingSnapshot: {
    type: designListingSnapshotSchema,
    default: null,
  },
  internalTemplateSnapshot: {
    type: designInternalTemplateSnapshotSchema,
    default: null,
  },
  assignedDesignerId: {
    type: Schema.Types.ObjectId,
    default: null,
    index: true,
  },
  assignedAt: {
    type: Date,
    default: null,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  submittedAssetIds: [{
    type: Schema.Types.ObjectId,
    ref: 'MediaAsset',
  }],
  approvedAssetId: {
    type: Schema.Types.ObjectId,
    ref: 'MediaAsset',
    default: null,
  },
  submissions: {
    type: [designTaskSubmissionSchema],
    default: [],
  },
  note: {
    type: String,
    trim: true,
    default: null,
  },
  rejectReason: {
    type: String,
    trim: true,
    default: null,
  },
  submittedBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  submittedAt: {
    type: Date,
    default: null,
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  rejectedBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
  },
  cancelledBy: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

designTaskSchema.index(
  { listingId: 1, listingVariantId: 1, taskType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: activeDesignTaskStatuses },
    },
  },
);
designTaskSchema.index({ shopId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('DesignTask', designTaskSchema);
