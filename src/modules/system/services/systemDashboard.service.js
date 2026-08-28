const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const systemHealth = require('./systemHealth.service');

function hasGlobalPermission(authContext, permission) {
  return authPublic.isSuperAdmin(authContext) || (authContext.permissions || []).includes(permission);
}

async function getDashboard(authContext) {
  const canReadAccounts = hasGlobalPermission(authContext, 'AUTH:READ');
  const canReadAudit = hasGlobalPermission(authContext, 'AUDIT:READ');
  const [accounts, health, recentAudit] = await Promise.all([
    canReadAccounts ? authPublic.getAccountStatusCounts() : null,
    canReadAudit ? systemHealth.getHealth() : null,
    canReadAudit ? auditPublic.listEvents({ limit: 5 }, authContext) : null,
  ]);
  return {
    ...(accounts ? { accounts } : {}),
    ...(health ? { health } : {}),
    ...(recentAudit ? { recentAudit } : {}),
  };
}

module.exports = { getDashboard };
