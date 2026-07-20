const mongoose = require('mongoose');
const { shipmentStatuses } = require('../constants/shipment.constants');

const { Schema } = mongoose;

const shipmentSchema = new Schema({
  vendorSubmissionId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'VendorSubmission',
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
  provider: {
    type: String,
    trim: true,
    uppercase: true,
    default: null,
    index: true,
  },
  externalOrderId: {
    type: String,
    trim: true,
    default: null,
    index: true,
  },
  vendorExternalOrderId: {
    type: String,
    trim: true,
    default: null,
    index: true,
  },
  carrier: {
    type: String,
    trim: true,
    default: null,
  },
  trackingNumber: {
    type: String,
    trim: true,
    default: null,
  },
  trackingUrl: {
    type: String,
    trim: true,
    default: null,
  },
  status: {
    type: String,
    enum: Object.values(shipmentStatuses),
    default: shipmentStatuses.TRACKING_PENDING,
    index: true,
  },
  shippedAt: {
    type: Date,
    default: null,
  },
  deliveredAt: {
    type: Date,
    default: null,
  },
  note: {
    type: String,
    trim: true,
    default: null,
  },
}, {
  timestamps: true,
});

shipmentSchema.index(
  { vendorSubmissionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          shipmentStatuses.TRACKING_PENDING,
          shipmentStatuses.SHIPPED,
          shipmentStatuses.DELIVERED,
          shipmentStatuses.EXCEPTION,
          shipmentStatuses.RETURNED,
        ],
      },
    },
  },
);
shipmentSchema.index({ shopId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('Shipment', shipmentSchema);
