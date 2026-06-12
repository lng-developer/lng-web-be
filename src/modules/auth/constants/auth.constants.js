const roleCodes = Object.freeze({
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  OPERATOR: 'OPERATOR',
});

const accountStatuses = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

module.exports = {
  roleCodes,
  accountStatuses,
};
