function personalSellerAccountId(auth = {}) {
  if (auth.system || auth.worker || auth.import) return null;
  const roles = new Set([...(auth.roles || []), ...(auth.scopes || []).flatMap(scope => scope.roles || [])]);
  if (!roles.has('SALES') || ['SUPER_ADMIN', 'ADMIN', 'SYSTEM_ADMIN', 'SALES_LEADER'].some(role => roles.has(role))) return null;
  return auth.accountId ? String(auth.accountId) : null;
}

module.exports = { personalSellerAccountId };
