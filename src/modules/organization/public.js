const organizationService = require('./services/organization.service');

const publicPort = {
  getDepartmentById: organizationService.getDepartment,
  getTeamById: organizationService.getTeam,
  listTeamMembers: organizationService.listTeamMembers,
  listTeamsByDepartment: organizationService.listTeamsByDepartment,
  listAccountOrganizationSummaries: organizationService.listAccountOrganizationSummaries,
};

module.exports = publicPort;
