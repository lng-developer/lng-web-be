const crypto = require('crypto');
const auditPublic = require('../../audit/public');
const logger = require('../../../shared/utils/logger');
const AUDIT_SOURCES = new Set(['HTTP', 'WORKER', 'SYSTEM', 'IMPORT']);

async function recordDesignOperation({
  action,
  entityType = 'DESIGN_TASK',
  entityId,
  shopId,
  authContext = {},
  changes = null,
  metadata = {},
  operationId = crypto.randomUUID(),
}) {
  try {
    return await auditPublic.record({
      actorType: authContext.accountId ? 'ACCOUNT' : 'SYSTEM',
      actorAccountId: authContext.accountId || null,
      actorSnapshot: {},
      action,
      entityType,
      entityId: String(entityId),
      scopeType: shopId ? 'SHOP' : null,
      scopeId: shopId ? String(shopId) : null,
      outcome: 'SUCCEEDED',
      source: (AUDIT_SOURCES.has(authContext.source) ? authContext.source : null)
        || (authContext.worker ? 'WORKER' : null)
        || (authContext.import ? 'IMPORT' : null)
        || (authContext.system ? 'SYSTEM' : 'HTTP'),
      requestId: authContext.auditContext?.requestId || null,
      ipAddress: authContext.auditContext?.ipAddress || null,
      userAgent: authContext.auditContext?.userAgent || null,
      changes,
      metadata,
      deduplicationKey: `design:${action.toLowerCase()}:${entityId}:${operationId}`,
    });
  } catch (error) {
    logger.warn('Design audit write failed after mutation commit', { action, entityId: String(entityId), error });
    return null;
  }
}

module.exports = {
  recordDesignOperation,
};
