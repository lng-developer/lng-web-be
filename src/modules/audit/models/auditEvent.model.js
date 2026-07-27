const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema({
  actorAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  action: { type: String, required: true, trim: true },
  entityType: { type: String, required: true, trim: true },
  entityId: { type: String, required: true, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  deduplicationKey: { type: String, required: true, unique: true, trim: true },
}, { timestamps: true, versionKey: false });

auditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditEvent', auditEventSchema);
