const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  mediaId: { type: String, required: true, trim: true, maxlength: 200 },
  filename: { type: String, default: null, trim: true, maxlength: 255 },
  mimeType: { type: String, default: null, trim: true, maxlength: 100 },
}, { _id: false });

const eventDetailsSchema = new mongoose.Schema({
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  location: { type: String, default: null, trim: true, maxlength: 300 },
  isMandatory: { type: Boolean, default: false },
}, { _id: false });

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  content: { type: String, required: true, trim: true, maxlength: 20000 },
  category: { type: String, enum: ['NEWS', 'POLICY', 'EVENT', 'OTHER'], default: 'NEWS' },
  priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
  attachments: { type: [attachmentSchema], default: [] },
  authorAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, immutable: true },
  sendToAll: { type: Boolean, default: true },
  targetDepartmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  targetProfileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployeeProfile' }],
  status: { type: String, enum: ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT' },
  isPinned: { type: Boolean, default: false },
  scheduledAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  publishedNotifiedAt: { type: Date, default: null },
  remindAt: { type: Date, default: null },
  reminderSentAt: { type: Date, default: null },
  eventDetails: { type: eventDetailsSchema, default: null },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

announcementSchema.index({ status: 1, scheduledAt: 1 });
announcementSchema.index({ status: 1, publishedNotifiedAt: 1 });
announcementSchema.index({ status: 1, reminderSentAt: 1, remindAt: 1 });
announcementSchema.index({ 'eventDetails.startDate': 1 });

module.exports = mongoose.models.HrAnnouncement || mongoose.model('HrAnnouncement', announcementSchema);
