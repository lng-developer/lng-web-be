const mongoose = require('mongoose');

const payrollEmailJobSchema = new mongoose.Schema({
  payrollRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrPayrollRun', required: true, immutable: true },
  payrollResultId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrPayrollResult', required: true, immutable: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile', required: true, immutable: true },
  recipientAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, immutable: true },
  recipientEmail: { type: String, required: true, trim: true, lowercase: true, immutable: true },
  requestedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, immutable: true },
  deduplicationKey: { type: String, required: true, trim: true, immutable: true },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'SENT', 'FAILED'], default: 'PENDING' },
  attemptCount: { type: Number, min: 0, default: 0 },
  lastErrorCode: { type: String, default: null, trim: true },
  providerMessageId: { type: String, default: null, trim: true },
  processingAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

payrollEmailJobSchema.index({ payrollRunId: 1, payrollResultId: 1 }, { unique: true });
payrollEmailJobSchema.index({ deduplicationKey: 1 }, { unique: true });
payrollEmailJobSchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.models.HrPayrollEmailJob || mongoose.model('HrPayrollEmailJob', payrollEmailJobSchema);
