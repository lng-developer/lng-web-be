function toAuditEventDto(event) {
  return event ? {
    id: String(event._id || event.id),
    actorType: event.actorType,
    actorAccountId: event.actorAccountId ? String(event.actorAccountId) : null,
    actorSnapshot: event.actorSnapshot || {},
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
    changes: event.changes || null,
    metadata: event.metadata || {},
    deduplicationKey: event.deduplicationKey,
    createdAt: event.createdAt || null,
  } : null;
}

module.exports = { toAuditEventDto };
