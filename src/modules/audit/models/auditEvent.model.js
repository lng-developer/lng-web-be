const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema({
  actorType: { type: String, enum: ['ACCOUNT', 'SYSTEM', 'ANONYMOUS'], required: true },
  actorAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  actorSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  action: { type: String, required: true, trim: true },
  entityType: { type: String, required: true, trim: true },
  entityId: { type: String, required: true, trim: true },
  scopeType: { type: String, default: null, trim: true },
  scopeId: { type: String, default: null, trim: true },
  outcome: { type: String, enum: ['SUCCEEDED', 'FAILED'], required: true },
  source: { type: String, enum: ['HTTP', 'WORKER', 'SYSTEM', 'IMPORT'], required: true },
  requestId: { type: String, default: null, trim: true },
  ipAddress: { type: String, default: null, trim: true },
  userAgent: { type: String, default: null, trim: true },
  changes: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  deduplicationKey: { type: String, required: true, trim: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

auditEventSchema.index({ deduplicationKey: 1 }, { name: 'deduplicationKey_1', unique: true });
auditEventSchema.index(
  { entityType: 1, entityId: 1, createdAt: -1, _id: -1 },
  { name: 'audit_entity_timeline' },
);
auditEventSchema.index(
  { actorAccountId: 1, createdAt: -1, _id: -1 },
  { name: 'audit_actor_timeline' },
);
auditEventSchema.index(
  { scopeType: 1, scopeId: 1, createdAt: -1, _id: -1 },
  { name: 'audit_scope_timeline' },
);
auditEventSchema.index(
  { action: 1, createdAt: -1, _id: -1 },
  { name: 'audit_action_timeline' },
);

module.exports = mongoose.model('AuditEvent', auditEventSchema);
