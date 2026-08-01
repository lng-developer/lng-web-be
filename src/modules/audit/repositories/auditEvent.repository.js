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

function id(value) {
  return value === undefined || value === null ? null : String(value);
}

async function enrichReferences(items) {
  if (!items.length) return items;
  const accountIds = [...new Set(items.flatMap((event) => [
    id(event.actorAccountId),
    event.entityType === 'AUTH_ACCOUNT' ? id(event.entityId) : null,
  ]).filter((value) => value && AuditEvent.db.base.isValidObjectId(value)))];
  const scopePairs = items
    .filter((event) => event.scopeType && event.scopeId)
    .filter((event) => AuditEvent.db.base.isValidObjectId(event.scopeId))
    .map((event) => ({
      scopeType: event.scopeType,
      scopeId: new AuditEvent.db.base.Types.ObjectId(event.scopeId),
    }));
  const [accounts, profiles, scopes] = await Promise.all([
    accountIds.length
      ? AuditEvent.db.collection('accounts').find({ _id: { $in: accountIds.map((value) => new AuditEvent.db.base.Types.ObjectId(value)) } }).project({ email: 1 }).toArray()
      : [],
    accountIds.length
      ? AuditEvent.db.collection('employeeprofiles').find({ accountId: { $in: accountIds.map((value) => new AuditEvent.db.base.Types.ObjectId(value)) } }).project({ accountId: 1, employeeCode: 1, fullName: 1 }).toArray()
      : [],
    scopePairs.length
      ? AuditEvent.db.collection('scoperegistries').find({ $or: scopePairs }).project({ scopeType: 1, scopeId: 1, name: 1 }).toArray()
      : [],
  ]);
  const accountsById = new Map(accounts.map((account) => [id(account._id), account]));
  const profilesByAccount = new Map(profiles.map((profile) => [id(profile.accountId), profile]));
  const scopesByKey = new Map(scopes.map((scope) => [`${scope.scopeType}:${id(scope.scopeId)}`, scope]));
  return items.map((event) => {
    const actorId = id(event.actorAccountId);
    const actorAccount = accountsById.get(actorId);
    const actorProfile = profilesByAccount.get(actorId);
    const entityProfile = event.entityType === 'AUTH_ACCOUNT' ? profilesByAccount.get(id(event.entityId)) : null;
    const entityAccount = event.entityType === 'AUTH_ACCOUNT' ? accountsById.get(id(event.entityId)) : null;
    const scope = scopesByKey.get(`${event.scopeType}:${id(event.scopeId)}`);
    return {
      ...event,
      actorLabel: actorProfile?.fullName || actorAccount?.email || null,
      actorEmail: actorAccount?.email || null,
      actorEmployeeCode: actorProfile?.employeeCode || null,
      entityLabel: entityProfile?.fullName || entityAccount?.email || null,
      scopeLabel: scope?.name || null,
    };
  });
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
  const items = await enrichReferences(rows.slice(0, limit));
  return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
}

async function findById(eventId, scopes = null) {
  const filter = { _id: eventId };
  addScopeConstraint(filter, scopes);
  const event = await AuditEvent.findOne(filter).lean();
  return event ? (await enrichReferences([event]))[0] : null;
}

module.exports = { findById, list, upsertByDeduplicationKey };
