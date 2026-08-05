const mongoose = require('mongoose');
const { vendorSubmissionStatuses } = require('../constants/vendorSubmission.constants');

const { Schema } = mongoose;

const vendorSubmissionSchema = new Schema({
  productionTaskId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'ProductionTask',
  },
  orderId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Order',
    index: true,
  },
  orderItemId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'OrderItem',
    index: true,
  },
  shopId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Shop',
    index: true,
  },
  fulfillmentPlanId: {
    type: Schema.Types.ObjectId,
    ref: 'FulfillmentPlan',
    default: null,
  },
  vendorProductId: {
    type: Schema.Types.ObjectId,
    ref: 'VendorProduct',
    default: null,
  },
  vendorCostCenterId: {
    type: Schema.Types.ObjectId,
    ref: 'VendorCostCenter',
    default: null,
  },
  status: {
    type: String,
    enum: Object.values(vendorSubmissionStatuses),
    default: vendorSubmissionStatuses.DRAFT,
    index: true,
  },
  provider: {
    type: String,
    trim: true,
    uppercase: true,
    default: null,
    index: true,
  },
  submitOperationKey: { type: String, trim: true, default: null },
  submitClaimedAt: { type: Date, default: null },
  submitAttemptCount: { type: Number, min: 0, default: 0 },
  vendorExternalOrderId: {
    type: String,
    trim: true,
    default: null,
    index: true,
  },
  submittedResponse: {
    type: Schema.Types.Mixed,
    default: null,
  },
  statusHistory: [{
    status: {
      type: String,
      enum: Object.values(vendorSubmissionStatuses),
      required: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    at: {
      type: Date,
      default: Date.now,
    },
  }],
  payloadSnapshot: {
    type: Schema.Types.Mixed,
    default: {},
  },
  submittedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Account',
    default: null,
  },
  submittedAt: {
    type: Date,
    default: null,
  },
  failedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Account',
    default: null,
  },
  failedAt: {
    type: Date,
    default: null,
  },
  failureReason: {
    type: String,
    trim: true,
    default: null,
  },
  cancelledBy: {
    type: Schema.Types.ObjectId,
    ref: 'Account',
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
  cancelReason: {
    type: String,
    trim: true,
    default: null,
  },
}, {
  timestamps: true,
});

vendorSubmissionSchema.index(
  { productionTaskId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          vendorSubmissionStatuses.DRAFT,
          vendorSubmissionStatuses.READY,
          vendorSubmissionStatuses.SUBMITTING,
          vendorSubmissionStatuses.SUBMITTED,
          vendorSubmissionStatuses.FAILED,
          vendorSubmissionStatuses.NEEDS_REVIEW,
        ],
      },
    },
  },
);
vendorSubmissionSchema.index({ shopId: 1, status: 1, updatedAt: -1 });
vendorSubmissionSchema.index({ orderItemId: 1, status: 1 });

module.exports = mongoose.model('VendorSubmission', vendorSubmissionSchema);
