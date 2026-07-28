const AuditEvent = require('../models/auditEvent.model');

async function create(payload, { session } = {}) {
  const [event] = await AuditEvent.create([payload], session ? { session } : {});
  return event.toObject();
}

async function findByDeduplicationKey(deduplicationKey, { session } = {}) {
  const query = AuditEvent.findOne({ deduplicationKey });
  if (session) query.session(session);
  return query.lean();
}

module.exports = { create, findByDeduplicationKey };
