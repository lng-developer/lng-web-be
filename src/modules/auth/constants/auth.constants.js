const roleCodes = Object.freeze({
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  OPERATOR: 'OPERATOR',
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

module.exports = {
  roleCodes,
  accountStatuses,
  accessAssignmentStatuses,
  accessScopeTypes,
};
