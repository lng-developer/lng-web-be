const mongoose = require('mongoose');

const saturdayRotationSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  workDateKey: { type: String, required: true, trim: true },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2000, max: 9999 },
  employeeProfileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile' }],
  minPresent: { type: Number, required: true, min: 0 },
}, { timestamps: true });

saturdayRotationSchema.pre('validate', function deriveRotationPeriod() {
  const date = new Date(`${this.workDateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== this.workDateKey || date.getUTCDay() !== 6) {
    this.invalidate('workDateKey', 'workDateKey must be a valid Saturday');
    return;
  }
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  if (this.month !== undefined && this.month !== month) this.invalidate('month', 'month must match workDateKey');
  if (this.year !== undefined && this.year !== year) this.invalidate('year', 'year must match workDateKey');
  this.month = month;
  this.year = year;
});

saturdayRotationSchema.index({ teamId: 1, workDateKey: 1 }, { unique: true });
saturdayRotationSchema.index({ teamId: 1, year: 1, month: 1 });

module.exports = mongoose.model('HrSaturdayRotation', saturdayRotationSchema);
