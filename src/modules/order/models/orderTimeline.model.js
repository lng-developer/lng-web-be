const mongoose = require('mongoose');

const { orderTimelineSources } = require('../constants/orderTimelineSources');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');

const orderTimelineSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderItem',
      default: null,
      index: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
      index: true,
    },
    salesChannelCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
      index: true,
    },
    marketplaceCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
      index: true,
    },
    eventType: {
      type: String,
      enum: Object.values(orderTimelineEventTypes),
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    message: {
      type: String,
      trim: true,
      default: null,
    },
    fromStatus: {
      type: String,
      trim: true,
      default: null,
    },
    toStatus: {
      type: String,
      trim: true,
      default: null,
    },
    source: {
      type: String,
      enum: Object.values(orderTimelineSources),
      uppercase: true,
      trim: true,
      default: orderTimelineSources.SYSTEM,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    idempotencyKey: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

orderTimelineSchema.index({ orderId: 1, createdAt: -1, _id: -1 });
orderTimelineSchema.index({ orderItemId: 1, createdAt: -1 });
orderTimelineSchema.index({ shopId: 1, createdAt: -1 });
orderTimelineSchema.index({ eventType: 1, createdAt: -1 });
orderTimelineSchema.index({ salesChannelCode: 1, marketplaceCode: 1, createdAt: -1 });
orderTimelineSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('OrderTimeline', orderTimelineSchema);
