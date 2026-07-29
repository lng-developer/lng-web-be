function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toStaffProvisioningDto({ account, profile, year }) {
  return {
    accountId: toId(account),
    profile: {
      id: toId(profile),
      employeeCode: profile.employeeCode,
      fullName: profile.fullName,
      workEmail: profile.workEmail,
      departmentId: toId(profile.departmentId),
      teamId: toId(profile.teamId),
      jobTitle: profile.jobTitle || null,
      jobLevel: profile.jobLevel || null,
      employmentType: profile.employmentType,
      workMode: profile.workMode,
      startDate: profile.startDate,
      probationEndDate: profile.probationEndDate || null,
      status: profile.status,
    },
    mustChangePassword: true,
    isProfileUpdated: false,
    leaveBalance: { year, leaveType: 'ANNUAL' },
  };
}

function toAssignableRoleCatalogDto(roles = []) {
  return roles.map((role) => ({
    id: toId(role),
    name: role.name,
    description: role.description || null,
  }));
}

module.exports = { toStaffProvisioningDto, toAssignableRoleCatalogDto };
