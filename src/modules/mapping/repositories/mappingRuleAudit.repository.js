const MappingRuleAudit = require('../models/mappingRuleAudit.model');

function create(payload) {
  return MappingRuleAudit.create(payload).then((doc) => doc.toObject());
}

function listByRule(ruleType, ruleId) {
  return MappingRuleAudit.find({ ruleType, ruleId }).sort({ createdAt: -1, _id: -1 }).lean();
}

module.exports = { create, listByRule };
