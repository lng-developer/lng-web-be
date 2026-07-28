const { sanitizeAuditData } = require('../validators/auditEvent.validator');

function toAuditEventDto(event) {
  return event ? Object.assign(Object.create(null), {
    id: String(event._id || event.id),
    actorType: event.actorType,
    actorAccountId: event.actorAccountId ? String(event.actorAccountId) : null,
    actorSnapshot: sanitizeAuditData(event.actorSnapshot || {}),
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    scopeType: event.scopeType || null,
    scopeId: event.scopeId || null,
    outcome: event.outcome,
    source: event.source,
    requestId: event.requestId || null,
    ipAddress: event.ipAddress || null,
    userAgent: event.userAgent || null,
    changes: event.changes ? sanitizeAuditData(event.changes) : null,
    metadata: sanitizeAuditData(event.metadata || {}),
    deduplicationKey: event.deduplicationKey,
    createdAt: event.createdAt || null,
  }) : null;
}

module.exports = { toAuditEventDto };
