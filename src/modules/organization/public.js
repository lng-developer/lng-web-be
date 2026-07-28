const organizationService = require('./services/organization.service');

const publicPort = {
  getDepartmentById: organizationService.getDepartment,
  getTeamByCode: organizationService.getTeamByCode,
  getTeamById: organizationService.getTeam,
  listDepartmentsByIds: async (ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    return (await organizationService.listDepartments({ ids: uniqueIds, page: 1, limit: uniqueIds.length })).items;
  },
  listTeamsByIds: async (ids = []) => {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    if (!uniqueIds.length) return [];
    return (await organizationService.listTeams({ ids: uniqueIds, page: 1, limit: uniqueIds.length })).items;
  },
  listTeamMembers: organizationService.listTeamMembers,
  listTeamsByDepartment: organizationService.listTeamsByDepartment,
  listAccountOrganizationSummaries: organizationService.listAccountOrganizationSummaries,
  migrateLegacyDepartments: organizationService.migrateLegacyDepartments,
  resolveLegacyDepartments: organizationService.resolveLegacyDepartments,
  migrateLegacyTeams: organizationService.migrateLegacyTeams,
  resolveLegacyTeams: organizationService.resolveLegacyTeams,
  migrateLegacyMemberships: organizationService.migrateLegacyMemberships,
};

module.exports = publicPort;
