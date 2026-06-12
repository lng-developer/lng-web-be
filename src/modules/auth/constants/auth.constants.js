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

module.exports = {
  roleCodes,
  accountStatuses,
};
