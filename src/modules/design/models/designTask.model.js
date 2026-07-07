const mongoose = require('mongoose');
const {
  activeDesignTaskStatuses,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');

const { Schema } = mongoose;

const designTaskSchema = new Schema({
  listingId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Listing',
    index: true,
  },
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
  taskType: {
    type: String,
    enum: Object.values(designTaskTypes),
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: Object.values(designTaskStatuses),
    default: designTaskStatuses.OPEN,
    index: true,
  },
  listingSnapshot: {
    type: Schema.Types.Mixed,
    default: null,
  },
  internalTemplateSnapshot: {
    type: Schema.Types.Mixed,
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
  { listingId: 1, taskType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: activeDesignTaskStatuses },
    },
  },
);
designTaskSchema.index({ shopId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('DesignTask', designTaskSchema);
