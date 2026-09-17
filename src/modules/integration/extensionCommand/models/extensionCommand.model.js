const mongoose = require('mongoose');
const { extensionCommandTypes, extensionCommandStatuses } = require('../constants/extensionCommand.constants');

const extensionCommandSchema = new mongoose.Schema({
  type: { type: String, enum: Object.values(extensionCommandTypes), required: true },
  status: { type: String, enum: Object.values(extensionCommandStatuses), default: extensionCommandStatuses.QUEUED, index: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  activeOrderKey: { type: String, select: false },
  numDays: { type: Number, enum: [1, 2, 7, 15, 30], default: 1 },
  dateFrom: { type: String, default: null },
  dateTo: { type: String, default: null },
  financeScheduleId: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdByAccountId: { type: mongoose.Schema.Types.ObjectId, default: null },
  claimedAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  leaseExpiresAt: { type: Date, default: null, index: true },
  leaseTokenHash: { type: String, default: null, select: false },
  attemptCount: { type: Number, default: 0, min: 0 },
  importJobId: { type: mongoose.Schema.Types.ObjectId, default: null },
  result: { importedCount: { type: Number, default: 0, min: 0 }, failedCount: { type: Number, default: 0, min: 0 } },
  errorMessage: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });

extensionCommandSchema.index({ agentId: 1, status: 1, createdAt: 1 });
extensionCommandSchema.index({ shopId: 1, createdAt: -1 });
extensionCommandSchema.index({ activeOrderKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ExtensionCommand', extensionCommandSchema);
