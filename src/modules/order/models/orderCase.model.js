const mongoose = require('mongoose');
const { orderCaseStatuses, orderCaseSeverities } = require('../constants/orderStatuses');

const orderCaseSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true,
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
  caseType: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'OTHER',
    index: true,
  },
  status: {
    type: String,
    enum: Object.values(orderCaseStatuses),
    default: orderCaseStatuses.OPEN,
    index: true,
  },
  severity: {
    type: String,
    enum: Object.values(orderCaseSeverities),
    default: orderCaseSeverities.MEDIUM,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    default: null,
  },
  resolutionNote: {
    type: String,
    trim: true,
    default: null,
  },
  cancelReason: {
    type: String,
    trim: true,
    default: null,
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  resolvedAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  cancelledAt: { type: Date, default: null },
  comments: [{
    body: {
      type: String,
      required: true,
      trim: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

orderCaseSchema.index({ shopId: 1, status: 1, createdAt: -1 });
orderCaseSchema.index({ orderId: 1, status: 1 });
orderCaseSchema.index({ orderId: 1, status: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('OrderCase', orderCaseSchema);
