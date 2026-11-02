const mongoose = require('mongoose');
const { amazonTrackingSubmissionStatuses } = require('../constants/amazonTrackingSubmission.constants');

const trackingSubmissionRowSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  externalOrderId: { type: String, required: true },
  shipDate: { type: String, required: true },
  carrierCode: { type: String, required: true },
  trackingNumber: { type: String, required: true },
  shipMethod: { type: String, default: 'Standard' },
}, { _id: false });

const amazonTrackingSubmissionSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtensionAgent', required: true, index: true },
  commandId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtensionCommand', default: null, index: true },
  shipmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' }],
  rows: [trackingSubmissionRowSchema],
  filename: { type: String, required: true },
  tsv: { type: String, required: true },
  rowCount: { type: Number, required: true },
  checksum: { type: String, required: true },
  status: {
    type: String,
    enum: Object.values(amazonTrackingSubmissionStatuses),
    default: amazonTrackingSubmissionStatuses.PENDING,
    index: true,
  },
  amazonBatchId: { type: String, default: null },
  result: {
    importedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    diagnostics: [{ type: String }],
  },
  submittedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  errorMessage: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });

amazonTrackingSubmissionSchema.index({ shopId: 1, createdAt: -1 });

module.exports = mongoose.model('AmazonTrackingSubmission', amazonTrackingSubmissionSchema);
