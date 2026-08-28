function toSystemDashboardDto(readModel = {}) {
  return Object.assign(Object.create(null), {
    ...(readModel.accounts ? { accounts: readModel.accounts } : {}),
    ...(readModel.health ? { health: readModel.health } : {}),
    ...(readModel.recentAudit ? { recentAudit: readModel.recentAudit } : {}),
  });
}

module.exports = { toSystemDashboardDto };
