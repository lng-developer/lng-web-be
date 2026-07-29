const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const AuditEvent = require('../models/auditEvent.model');

const REQUIRED_INDEXES = Object.freeze([
  { name: 'deduplicationKey_1', key: { deduplicationKey: 1 }, unique: true },
  { name: 'audit_entity_timeline', key: { entityType: 1, entityId: 1, createdAt: -1, _id: -1 } },
  { name: 'audit_actor_timeline', key: { actorAccountId: 1, createdAt: -1, _id: -1 } },
  { name: 'audit_scope_timeline', key: { scopeType: 1, scopeId: 1, createdAt: -1, _id: -1 } },
  { name: 'audit_action_timeline', key: { action: 1, createdAt: -1, _id: -1 } },
  { name: 'audit_default_timeline', key: { createdAt: -1, _id: -1 } },
]);

function safeDatabaseTarget(connection) {
  const host = String(connection?.host || '').trim();
  const database = String(connection?.name || '').trim();
  if (!host || !database) throw new Error('Mongo target host and database are unavailable');
  return { host, ...(Number.isInteger(connection.port) ? { port: connection.port } : {}), database };
}

function sameKey(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isEquivalent(actual, required) {
  const defaultCollation = !actual.collation || actual.collation.locale === 'simple';
  return actual.name === required.name
    && sameKey(actual.key, required.key)
    && Boolean(actual.unique) === Boolean(required.unique)
    && actual.partialFilterExpression === undefined
    && actual.sparse !== true
    && actual.hidden !== true
    && actual.expireAfterSeconds === undefined
    && defaultCollation;
}

async function ensureAuditIndexes(target) {
  if (!target?.host || !target?.database) throw new Error('Mongo target host and database are required');
  logger.info('Audit index target', { target });

  const duplicates = await AuditEvent.aggregate([
    { $group: { _id: '$deduplicationKey', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
    { $project: { _id: 0, count: 1 } },
  ]);
  if (duplicates.length) throw new Error('Cannot create Audit indexes: duplicate deduplication keys exist');

  const existing = await AuditEvent.collection.indexes();
  const matches = new Map();
  for (const required of REQUIRED_INDEXES) {
    const sameName = existing.find((index) => index.name === required.name);
    const sameDefinition = existing.find((index) => sameKey(index.key, required.key));
    const match = sameName || sameDefinition;
    if (match && !isEquivalent(match, required)) {
      throw new Error(`Conflicting Audit index: ${required.name}`);
    }
    matches.set(required.name, match);
  }

  const created = [];
  const verified = [];
  for (const required of REQUIRED_INDEXES) {
    if (matches.get(required.name)) {
      verified.push(required.name);
      continue;
    }
    await AuditEvent.collection.createIndex(required.key, {
      name: required.name,
      ...(required.unique ? { unique: true } : {}),
    });
    created.push(required.name);
    verified.push(required.name);
  }
  return { target, created, verified };
}

async function runEnsureAuditIndexes() {
  const connection = await connectDatabase();
  try {
    const result = await ensureAuditIndexes(safeDatabaseTarget(connection));
    logger.info('Audit indexes ensured', result);
    return result;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  runEnsureAuditIndexes().catch((error) => {
    logger.error('Audit index setup failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { ensureAuditIndexes, runEnsureAuditIndexes, safeDatabaseTarget };
