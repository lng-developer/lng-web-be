function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toEmployeeProfileDirectoryDto(profile, { capabilities = null, department = null, team = null } = {}) {
  if (!profile) return null;

  const dto = {
    id: toId(profile),
    employeeCode: profile.employeeCode || null,
    fullName: profile.fullName || null,
    avatarUrl: profile.avatarUrl || null,
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
    department,
    team,
    jobTitle: profile.jobTitle || null,
    jobLevel: profile.jobLevel || null,
    employmentType: profile.employmentType || null,
    workMode: profile.workMode || null,
    status: profile.status || null,
  };
  if (capabilities) dto.capabilities = capabilities;
  return dto;
}

function toEmployeeProfileDetailDto(profile, {
  capabilities = null, includeSensitive = false, department = null, team = null,
} = {}) {
  if (!profile) return null;

  const dto = {
    id: toId(profile),
    accountId: toId(profile.accountId),
    employeeCode: profile.employeeCode || null,
    fullName: profile.fullName || null,
    gender: profile.gender || null,
    birthDate: profile.birthDate || null,
    phoneNumber: profile.phoneNumber || null,
    address: profile.address || null,
    avatarUrl: profile.avatarUrl || null,
    personalEmail: profile.personalEmail || null,
    workEmail: profile.workEmail || null,
    emergencyContact: profile.emergencyContact || null,
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
    department,
    team,
    jobTitle: profile.jobTitle || null,
    jobLevel: profile.jobLevel || null,
    employmentType: profile.employmentType || null,
    workMode: profile.workMode || null,
    startDate: profile.startDate || null,
    probationEndDate: profile.probationEndDate || null,
    endDate: profile.endDate || null,
    status: profile.status || null,
    contractType: profile.contractType || null,
    contractNumber: profile.contractNumber || null,
    contractStartDate: profile.contractStartDate || null,
    contractEndDate: profile.contractEndDate || null,
    promotionDate: profile.promotionDate || null,
    transferDate: profile.transferDate || null,
    dependantDetails: profile.dependantDetails || [],
    dependants: profile.dependants ?? 0,
    isProfileUpdated: Boolean(profile.isProfileUpdated),
    isDeleted: Boolean(profile.isDeleted),
    deletedAt: profile.deletedAt || null,
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
  };

  if (includeSensitive) {
    dto.identityCard = profile.identityCard || null;
    dto.taxIdentification = profile.taxIdentification || null;
    dto.socialInsuranceNumber = profile.socialInsuranceNumber || null;
    dto.bankAccount = profile.bankAccount || null;
    dto.baseCurrency = profile.baseCurrency || 'VND';
    dto.baseSalary = profile.baseSalary ?? 0;
    dto.allowances = profile.allowances || { lunch: 0, fuel: 0, other: 0 };
    dto.responsibilityAllowance = profile.responsibilityAllowance ?? 0;
  }
  if (capabilities) dto.capabilities = capabilities;

  return dto;
}

function toPaginatedEmployeeProfileDto(result, optionsForItem) {
  return {
    items: (result.items || []).map((item) => toEmployeeProfileDirectoryDto(
      item,
      typeof optionsForItem === 'function' ? optionsForItem(item) : optionsForItem,
    )),
    pagination: result.pagination,
  };
}

module.exports = {
  toEmployeeProfileDto: toEmployeeProfileDetailDto,
  toEmployeeProfileDetailDto,
  toEmployeeProfileDirectoryDto,
  toPaginatedEmployeeProfileDto,
};
