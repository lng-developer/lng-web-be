const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const AuditEvent = require('../models/auditEvent.model');
const { safeDatabaseTarget } = require('./ensureAuditIndexes');

// These are the only central Audit writers that existed before the Task 1 contract.
// Their services required an authenticated account and recorded successful HTTP mutations/exports.
const PROVEN_LEGACY_ENTITY_TYPES = Object.freeze([
  'HR_LEAVE_REQUEST',
  'HR_OVERTIME_REQUEST',
  'HR_PAYROLL_RUN',
  'HR_PAYROLL_RESULT',
  'HR_PAYROLL_RESULT_EXPORT',
  'HR_PAYROLL_ADJUSTMENT',
]);

const LEGACY_FILTER = Object.freeze({
  $or: [
    { actorType: { $exists: false } },
    { actorType: null },
    { outcome: { $exists: false } },
    { outcome: null },
    { source: { $exists: false } },
    { source: null },
  ],
});

const MIGRATABLE_FILTER = Object.freeze({
  $and: [
    LEGACY_FILTER,
    { entityType: { $in: PROVEN_LEGACY_ENTITY_TYPES } },
    { actorAccountId: { $type: 'objectId' } },
  ],
});

async function migrateLegacyAuditEvents({ apply = false } = {}) {
  const [legacyCount, migratableCount] = await Promise.all([
    AuditEvent.collection.countDocuments(LEGACY_FILTER),
    AuditEvent.collection.countDocuments(MIGRATABLE_FILTER),
  ]);
  const proof = {
    apply: Boolean(apply),
    legacyCount,
    migratableCount,
    unresolvedCount: legacyCount - migratableCount,
    modifiedCount: 0,
  };
  if (!apply) return proof;
  if (proof.unresolvedCount) {
    throw new Error(`Cannot migrate Audit events: ${proof.unresolvedCount} unresolved legacy audit rows`);
  }
  if (!migratableCount) return proof;

  const result = await AuditEvent.collection.updateMany(MIGRATABLE_FILTER, [{
    $set: {
      actorType: { $ifNull: ['$actorType', 'ACCOUNT'] },
      outcome: { $ifNull: ['$outcome', 'SUCCEEDED'] },
      source: { $ifNull: ['$source', 'HTTP'] },
    },
  }]);
  return { ...proof, modifiedCount: result.modifiedCount };
}

async function runMigrateLegacyAuditEvents({ apply = process.argv.includes('--apply') } = {}) {
  const connection = await connectDatabase();
  try {
    const target = safeDatabaseTarget(connection);
    logger.info('Legacy Audit migration target', { target, apply });
    const proof = await migrateLegacyAuditEvents({ apply });
    logger.info('Legacy Audit migration proof', proof);
    return { target, ...proof };
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  runMigrateLegacyAuditEvents().catch((error) => {
    logger.error('Legacy Audit migration failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { migrateLegacyAuditEvents, runMigrateLegacyAuditEvents };
