const mongoose = require('mongoose');

const mappingRuleAuditSchema = new mongoose.Schema({
  ruleType: { type: String, required: true, index: true },
  ruleId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  event: { type: String, enum: ['CREATED', 'UPDATED', 'STATUS_CHANGED'], required: true },
  actorAccountId: { type: mongoose.Schema.Types.ObjectId, default: null },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

mappingRuleAuditSchema.index({ ruleType: 1, ruleId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('MappingRuleAudit', mappingRuleAuditSchema);
