const { sanitizeAuditData } = require('../validators/auditEvent.validator');

function toAuditEventDto(event) {
  return event ? Object.assign(Object.create(null), {
    id: String(event._id || event.id),
    actorType: event.actorType,
    actorAccountId: event.actorAccountId ? String(event.actorAccountId) : null,
    actorSnapshot: sanitizeAuditData(event.actorSnapshot || {}),
    actorLabel: event.actorLabel || null,
    actorEmail: event.actorEmail || null,
    actorEmployeeCode: event.actorEmployeeCode || null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    entityLabel: event.entityLabel || null,
    scopeType: event.scopeType || null,
    scopeId: event.scopeId || null,
    scopeLabel: event.scopeLabel || null,
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

function toAuditEventListDto(result) {
  const items = result.items.map(toAuditEventDto);
  Object.defineProperty(items, 'toJSON', { value: undefined });
  return Object.assign(Object.create(null), { items, nextCursor: result.nextCursor || null });
}

module.exports = { toAuditEventDto, toAuditEventListDto };
