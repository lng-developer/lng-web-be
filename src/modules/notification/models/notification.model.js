const mongoose = require('mongoose');

const relatedResourceSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true },
  id: { type: String, required: true, trim: true },
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  recipientAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  type: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  relatedResource: { type: relatedResourceSchema, default: null },
  deduplicationKey: { type: String, required: true, trim: true },
  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index(
  { recipientAccountId: 1, deduplicationKey: 1 },
  { unique: true },
);
notificationSchema.index({ recipientAccountId: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
