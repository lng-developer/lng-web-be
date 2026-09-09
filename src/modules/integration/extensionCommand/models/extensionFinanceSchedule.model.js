const mongoose = require('mongoose');
const { financeScheduleSources } = require('../constants/extensionCommand.constants');

const extensionFinanceScheduleSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  source: { type: String, enum: Object.values(financeScheduleSources), required: true },
  enabled: { type: Boolean, default: false, index: true },
  intervalMinutes: { type: Number, default: 1440, immutable: true },
  nextRunAt: { type: Date, required: true, index: true },
  lastQueuedAt: { type: Date, default: null },
  lastCompletedAt: { type: Date, default: null },
  lastSuccessfulDate: { type: String, default: null },
  lastError: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });

extensionFinanceScheduleSchema.index({ agentId: 1, source: 1 }, { unique: true });
extensionFinanceScheduleSchema.index({ enabled: 1, nextRunAt: 1 });

module.exports = mongoose.model('ExtensionFinanceSchedule', extensionFinanceScheduleSchema);
