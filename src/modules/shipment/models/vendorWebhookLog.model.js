const mongoose = require('mongoose');
const { vendorWebhookOutcomes } = require('../constants/shipment.constants');

const { Schema } = mongoose;

const vendorWebhookLogSchema = new Schema({
  provider: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true,
  },
  outcome: {
    type: String,
    enum: Object.values(vendorWebhookOutcomes),
    required: true,
    index: true,
  },
  httpStatus: {
    type: Number,
    default: null,
    index: true,
  },
  message: {
    type: String,
    trim: true,
    default: '',
  },
  shopId: {
    type: Schema.Types.ObjectId,
    default: null,
    index: true,
  },
  vendorSubmissionId: {
    type: Schema.Types.ObjectId,
    default: null,
    index: true,
  },
  orderItemId: {
    type: Schema.Types.ObjectId,
    default: null,
    index: true,
  },
  trackingNumber: {
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
  vendorStatus: {
    type: String,
    trim: true,
    default: null,
  },
  request: {
    method: { type: String, trim: true, default: '' },
    path: { type: String, trim: true, default: '' },
    ip: { type: String, trim: true, default: '' },
    userAgent: { type: String, trim: true, default: '' },
  },
  rawPayload: {
    type: Schema.Types.Mixed,
    default: null,
  },
  result: {
    type: Schema.Types.Mixed,
    default: null,
  },
}, {
  timestamps: true,
});

vendorWebhookLogSchema.index({ provider: 1, createdAt: -1 });
vendorWebhookLogSchema.index({ outcome: 1, createdAt: -1 });
vendorWebhookLogSchema.index({ shopId: 1, createdAt: -1 });
vendorWebhookLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model('VendorWebhookLog', vendorWebhookLogSchema);
