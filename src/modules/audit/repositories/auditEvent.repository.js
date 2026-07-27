const AuditEvent = require('../models/auditEvent.model');

async function create(payload) {
  return (await AuditEvent.create(payload)).toObject();
}

async function findByDeduplicationKey(deduplicationKey) {
  return AuditEvent.findOne({ deduplicationKey }).lean();
}

module.exports = { create, findByDeduplicationKey };
