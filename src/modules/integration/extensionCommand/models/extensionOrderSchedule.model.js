const mongoose = require('mongoose');

const extensionOrderScheduleSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  enabled: { type: Boolean, default: false, index: true },
  intervalMinutes: { type: Number, enum: [60, 120, 180, 240], default: 120 },
  nextRunAt: { type: Date, required: true, index: true },
  lastQueuedAt: { type: Date, default: null },
  lastError: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });

extensionOrderScheduleSchema.index({ enabled: 1, nextRunAt: 1 });

module.exports = mongoose.model('ExtensionOrderSchedule', extensionOrderScheduleSchema);
