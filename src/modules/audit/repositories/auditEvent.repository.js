const AuditEvent = require('../models/auditEvent.model');

async function upsertByDeduplicationKey(payload, { session } = {}) {
  return AuditEvent.findOneAndUpdate(
    { deduplicationKey: payload.deduplicationKey },
    { $setOnInsert: payload },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, ...(session ? { session } : {}) },
  ).lean();
}

module.exports = { upsertByDeduplicationKey };
