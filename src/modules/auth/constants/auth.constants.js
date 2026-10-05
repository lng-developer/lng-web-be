const roleCodes = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  AUDITOR: 'AUDITOR',
  DEPARTMENT_MANAGER: 'DEPARTMENT_MANAGER',
  TEAM_LEADER: 'TEAM_LEADER',
  STAFF_VIEWER: 'STAFF_VIEWER',
  DESIGNER: 'DESIGNER',
  DESIGN_LEADER: 'DESIGN_LEADER',
  SCALE_OPERATOR: 'SCALE_OPERATOR',
  SCALE_LEADER: 'SCALE_LEADER',
  DESIGN_REVIEWER: 'DESIGN_REVIEWER',
  PRODUCTION_OPERATOR: 'PRODUCTION_OPERATOR',
  QC_REVIEWER: 'QC_REVIEWER',
  CS_OPERATOR: 'CS_OPERATOR',
  SALES: 'SALES',
  SALES_LEADER: 'SALES_LEADER',
  MAPPING_OPERATOR: 'MAPPING_OPERATOR',
  CATALOG_OPERATOR: 'CATALOG_OPERATOR',
  FULFILLMENT_OPERATOR: 'FULFILLMENT_OPERATOR',
  FINANCE_OPERATOR: 'FINANCE_OPERATOR',
  HR_OPERATOR: 'HR_OPERATOR',
  PAYROLL_OPERATOR: 'PAYROLL_OPERATOR',
  PAYROLL_MANAGER: 'PAYROLL_MANAGER',
  MANAGER: 'MANAGER',
  LEADER: 'LEADER',
  USER: 'USER',
});

const accountStatuses = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
});

const accessAssignmentStatuses = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

const accessScopeTypes = Object.freeze({
  GLOBAL: 'global',
  DEPARTMENT: 'department',
  TEAM: 'team',
  OWN: 'own',
  SHOP: 'shop',
  VENDOR: 'vendor',
});

const scopeRegistryStatuses = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

module.exports = {
  roleCodes,
  accountStatuses,
  accessAssignmentStatuses,
  accessScopeTypes,
  scopeRegistryStatuses,
};
