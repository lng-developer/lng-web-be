function toAuditEventDto(event) {
  return event ? {
    id: String(event._id || event.id),
    actorAccountId: event.actorAccountId ? String(event.actorAccountId) : null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata || {},
    createdAt: event.createdAt || null,
  } : null;
}

module.exports = { toAuditEventDto };
