const crypto = require('crypto');
const mongoose = require('mongoose');
const auditPublic = require('../../audit/public');
const logger = require('../../../shared/utils/logger');

async function recordOrderOperation({
  action,
  entityType,
  entityId,
  shopId,
  authContext = {},
  changes = null,
  metadata = {},
  operationId = crypto.randomUUID(),
  session = null,
}) {
  const actorAccountId = authContext.accountId || null;
  const httpContext = authContext.auditContext || {};
  try {
    return await auditPublic.record({
      actorType: actorAccountId ? 'ACCOUNT' : 'SYSTEM',
      actorAccountId,
      actorSnapshot: {},
      action,
      entityType,
      entityId: String(entityId),
      scopeType: shopId ? 'SHOP' : null,
      scopeId: shopId ? String(shopId) : null,
      outcome: 'SUCCEEDED',
      source: actorAccountId ? 'HTTP' : 'SYSTEM',
      requestId: httpContext.requestId || null,
      ipAddress: httpContext.ipAddress || null,
      userAgent: httpContext.userAgent || null,
      changes,
      metadata,
      deduplicationKey: `operations:${action.toLowerCase()}:${entityId}:${operationId}`,
    }, { session });
  } catch (error) {
    if (session) throw error;
    // ponytail: best-effort because these legacy mutation paths do not own Mongo sessions.
    logger.warn('Operation audit write failed after mutation commit', { action, entityId: String(entityId), error });
    return null;
  }
}

async function withOrderOperation(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { recordOrderOperation, withOrderOperation };
