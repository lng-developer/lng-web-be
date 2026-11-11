const mongoose = require('mongoose');

const extensionTrackingScheduleSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  enabled: { type: Boolean, default: false, index: true },
  scheduleType: { type: String, enum: ['INTERVAL', 'FIXED_TIMES'], default: 'INTERVAL' },
  fixedTimes: { type: [{ type: String }], default: [] },
  timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
  intervalMinutes: { type: Number, default: 120 },
  nextRunAt: { type: Date, required: true, index: true },
  lastQueuedAt: { type: Date, default: null },
  lastBatchCount: { type: Number, default: 0 },
  lastError: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });

extensionTrackingScheduleSchema.index({ enabled: 1, nextRunAt: 1 });

module.exports = mongoose.model('ExtensionTrackingSchedule', extensionTrackingScheduleSchema);
