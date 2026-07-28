const AuditEvent = require('../models/auditEvent.model');

function addConstraint(filter, constraint) {
  filter.$and = [...(filter.$and || []), constraint];
}

function addScopeConstraint(filter, scopes) {
  if (scopes === null) return;
  addConstraint(filter, scopes.length
    ? { $or: scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })) }
    : { _id: { $exists: false } });
}

function buildFilter(query = {}, scopes = null) {
  const { cursor, limit, dateFrom, dateTo, ...fields } = query;
  const filter = { ...fields };
  if (dateFrom || dateTo) {
    filter.createdAt = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {}),
    };
  }
  addScopeConstraint(filter, scopes);
  if (cursor) addConstraint(filter, { $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
  ] });
  return filter;
}

function encodeCursor(event) {
  return Buffer.from(JSON.stringify({
    createdAt: event.createdAt.toISOString(), id: String(event._id),
  })).toString('base64url');
}

async function upsertByDeduplicationKey(payload, { session } = {}) {
  return AuditEvent.findOneAndUpdate(
    { deduplicationKey: payload.deduplicationKey },
    { $setOnInsert: payload },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, ...(session ? { session } : {}) },
  ).lean();
}

async function list(query = {}, scopes = null) {
  const limit = query.limit || 20;
  const rows = await AuditEvent.find(buildFilter(query, scopes))
    .sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
}

async function findById(eventId, scopes = null) {
  const filter = { _id: eventId };
  addScopeConstraint(filter, scopes);
  return AuditEvent.findOne(filter).lean();
}

module.exports = { findById, list, upsertByDeduplicationKey };
