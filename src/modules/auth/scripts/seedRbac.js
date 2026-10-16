const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const { leaderHrPermissions, leaderRoleName } = require('../constants/leaderPermissionMatrix');
const Permission = require('../models/permission.model');
const Role = require('../models/role.model');
const { roleCodes } = require('../constants/auth.constants');

const permissions = [
  'AUTH:READ',
  'AUTH:WRITE',
  'AUDIT:READ',
  'ORDERS:READ',
  'ORDERS:WRITE',
  'ORDERS:ASSIGN',
  'ORDERS:CASE_MANAGE',
  'ORDERS:FULFILL',
  'CUSTOMERS:READ',
  'CUSTOMERS:WRITE',
  'CUSTOMERS:MANAGE',
  'CATALOG:READ',
  'CATALOG:WRITE',
  'DESIGN:READ',
  'DESIGN:WRITE',
  'DESIGN:WORK',
  'DESIGN:REVIEW',
  'DESIGN:PSD_REQUEST',
  'WORK_SCORES:READ',
  'WORK_SCORES:ADJUST',
  'DEPARTMENTS:READ',
  'DEPARTMENTS:WRITE',
  'INTEGRATION:READ',
  'INTEGRATION:WRITE',
  'MAPPING:READ',
  'MAPPING:WRITE',
  'MEDIA:READ',
  'MEDIA:WRITE',
  'PRODUCTION:READ',
  'PRODUCTION:SCALE_WORK',
  'PRODUCTION:SCALE_ASSIGN',
  'PRODUCTION:QC_REVIEW',
  'PRODUCTION:WRITE',
  'SHOPS:READ',
  'SHOPS:WRITE',
  'TEAMS:READ',
  'TEAMS:WRITE',
  'VENDORS:READ',
  'VENDORS:WRITE',
  'VENDOR_SUBMISSIONS:READ',
  'VENDOR_SUBMISSIONS:WRITE',
  'SHIPMENTS:READ',
  'SHIPMENTS:WRITE',
  'FINANCE:READ',
  'FINANCE:WRITE',
  'REPORTS:READ',
  'HR_EMPLOYEES:READ',
  'HR_EMPLOYEES:WRITE',
  'HR_COMPENSATION:READ',
  'HR_COMPENSATION:WRITE',
  'HR_SCHEDULE:READ',
  'HR_SCHEDULE:WRITE',
  'HR_ATTENDANCE:READ',
  'HR_ATTENDANCE:WRITE',
  'HR_ATTENDANCE:MANAGE',
  'HR_LEAVE:READ',
  'HR_LEAVE:WRITE',
  'HR_LEAVE:APPROVE',
  'HR_OVERTIME:READ',
  'HR_OVERTIME:WRITE',
  'HR_OVERTIME:APPROVE',
  'HR_CALENDAR:READ',
  'HR_CALENDAR:WRITE',
  'HR_SATURDAY_ROTATION:WRITE',
  'HR_PAYROLL:READ',
  'HR_PAYROLL:WRITE',
  'HR_PAYROLL:FINALIZE',
  'HR_PAYROLL:PAY',
  'HR_ANNOUNCEMENTS:READ',
  'HR_ANNOUNCEMENTS:WRITE',
  'HR_INTEGRATIONS:MANAGE',
];

const rolePermissions = {
  [roleCodes.SUPER_ADMIN]: permissions,
  [roleCodes.ADMIN]: permissions,
  [roleCodes.SYSTEM_ADMIN]: [
    'AUTH:READ',
    'AUTH:WRITE',
    'AUDIT:READ',
    'DEPARTMENTS:READ',
    'DEPARTMENTS:WRITE',
    'TEAMS:READ',
    'TEAMS:WRITE',
  ],
  [roleCodes.AUDITOR]: [
    'AUDIT:READ',
    'REPORTS:READ',
  ],
  [roleCodes.DEPARTMENT_MANAGER]: [
    'TEAMS:READ',
    'TEAMS:WRITE',
    'REPORTS:READ',
  ],
  [roleCodes.TEAM_LEADER]: [
    'REPORTS:READ',
  ],
  [roleCodes.STAFF_VIEWER]: [
    'CATALOG:READ',
    'MEDIA:READ',
  ],
  [roleCodes.DESIGNER]: [
    'CATALOG:READ',
    'MEDIA:READ',
    'DESIGN:WORK',
    'DESIGN:READ',
    'PRODUCTION:READ',
  ],
  [roleCodes.DESIGN_LEADER]: [
    'PRODUCTION:SCALE_ASSIGN',
    'CATALOG:READ',
    'MEDIA:READ',
    'DESIGN:READ',
    'DESIGN:WRITE',
    'DESIGN:WORK',
    'DESIGN:REVIEW',
    'PRODUCTION:READ',
    'WORK_SCORES:READ',
    'WORK_SCORES:ADJUST',
  ],
  [roleCodes.DESIGN_REVIEWER]: [
    'DESIGN:READ',
    'DESIGN:WRITE',
    'DESIGN:REVIEW',
    'WORK_SCORES:READ',
  ],
  [roleCodes.PRODUCTION_OPERATOR]: [
    'CATALOG:READ',
    'MEDIA:READ',
    'PRODUCTION:READ',
    'PRODUCTION:WRITE',
    'DESIGN:WORK',
  ],
  [roleCodes.QC_REVIEWER]: [
    'PRODUCTION:READ',
    'PRODUCTION:QC_REVIEW',
    'WORK_SCORES:READ',
  ],
  [roleCodes.SCALE_OPERATOR]: [
    'CATALOG:READ',
    'MEDIA:READ',
    'PRODUCTION:READ',
    'PRODUCTION:SCALE_WORK',
  ],
  [roleCodes.SCALE_LEADER]: [
    'CATALOG:READ',
    'MEDIA:READ',
    'PRODUCTION:READ',
    'PRODUCTION:SCALE_WORK',
    'PRODUCTION:SCALE_ASSIGN',
  ],
  [roleCodes.CS_OPERATOR]: [
    'ORDERS:READ',
    'ORDERS:WRITE',
    'CATALOG:READ',
    'MAPPING:READ',
    'PRODUCTION:READ',
    'SHIPMENTS:READ',
    'MEDIA:READ',
  ],
  [roleCodes.SALES]: [
    'ORDERS:READ',
    'ORDERS:WRITE',
    'CATALOG:READ',
    'CATALOG:WRITE',
    'MAPPING:READ',
    'MEDIA:READ',
    'DESIGN:PSD_REQUEST',
  ],
  [roleCodes.SALES_LEADER]: [
    'REPORTS:READ',
    'ORDERS:READ',
    'ORDERS:WRITE',
    'ORDERS:ASSIGN',
    'ORDERS:CASE_MANAGE',
    'CATALOG:READ',
    'CATALOG:WRITE',
    'MAPPING:READ',
    'PRODUCTION:READ',
    'SHIPMENTS:READ',
    'MEDIA:READ',
    'DESIGN:PSD_REQUEST',
  ],
  [roleCodes.MAPPING_OPERATOR]: [
    'MAPPING:READ',
    'MAPPING:WRITE',
    'CATALOG:READ',
    'VENDORS:READ',
  ],
  [roleCodes.CATALOG_OPERATOR]: [
    'CATALOG:READ',
    'CATALOG:WRITE',
    'MEDIA:READ',
    'MEDIA:WRITE',
    'MAPPING:READ',
  ],
  [roleCodes.FULFILLMENT_OPERATOR]: [
    'SHIPMENTS:READ',
    'SHIPMENTS:WRITE',
    'VENDOR_SUBMISSIONS:READ',
    'VENDOR_SUBMISSIONS:WRITE',
    'ORDERS:READ',
    'PRODUCTION:READ',
  ],
  [roleCodes.FINANCE_OPERATOR]: [
    'FINANCE:READ',
    'FINANCE:WRITE',
    'REPORTS:READ',
  ],
  [roleCodes.HR_OPERATOR]: [
    'HR_EMPLOYEES:READ',
    'HR_EMPLOYEES:WRITE',
    'HR_ATTENDANCE:READ',
    'HR_ATTENDANCE:MANAGE',
    'HR_LEAVE:READ',
    'HR_LEAVE:APPROVE',
    'HR_OVERTIME:READ',
    'HR_OVERTIME:APPROVE',
    'HR_SCHEDULE:READ',
    'HR_SCHEDULE:WRITE',
  ],
  [roleCodes.PAYROLL_OPERATOR]: [
    'HR_PAYROLL:READ',
    'HR_PAYROLL:WRITE',
  ],
  [roleCodes.PAYROLL_MANAGER]: [
    'HR_PAYROLL:READ',
    'HR_PAYROLL:WRITE',
    'HR_PAYROLL:FINALIZE',
    'HR_PAYROLL:PAY',
  ],
  [roleCodes.MANAGER]: [
    'AUTH:READ',
    'AUDIT:READ',
    'ORDERS:READ',
    'ORDERS:WRITE',
    'CATALOG:READ',
    'DESIGN:READ',
    'DESIGN:WRITE',
    'DESIGN:WORK',
    'DESIGN:REVIEW',
    'WORK_SCORES:READ',
    'WORK_SCORES:ADJUST',
    'DEPARTMENTS:READ',
    'DEPARTMENTS:WRITE',
    'INTEGRATION:READ',
    'MAPPING:READ',
    'MEDIA:READ',
    'PRODUCTION:READ',
    'PRODUCTION:WRITE',
    'SHOPS:READ',
    'TEAMS:READ',
    'TEAMS:WRITE',
    'VENDORS:READ',
    'VENDOR_SUBMISSIONS:READ',
    'VENDOR_SUBMISSIONS:WRITE',
    'SHIPMENTS:READ',
    'SHIPMENTS:WRITE',
    'FINANCE:READ',
    'REPORTS:READ',
    'HR_EMPLOYEES:READ',
    'HR_SCHEDULE:READ',
    'HR_ATTENDANCE:READ',
    'HR_LEAVE:READ',
    'HR_LEAVE:APPROVE',
    'HR_OVERTIME:READ',
    'HR_OVERTIME:APPROVE',
    'HR_CALENDAR:READ',
  ],
  [roleCodes.LEADER]: [...leaderHrPermissions],
  [roleCodes.USER]: [
    'HR_ATTENDANCE:WRITE',
    'HR_LEAVE:WRITE',
    'HR_OVERTIME:WRITE',
  ],
};

function toTitleCase(value) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildPermissionDescription(code) {
  const [resource, action] = String(code).split(':');
  return `Allows ${toTitleCase(action || 'access')} access for ${toTitleCase(resource || 'resource')}.`;
}

function buildPermissionName(code) {
  const [resource, action] = String(code).split(':');
  return `${toTitleCase(action || 'Access')} ${toTitleCase(resource || 'Resource')}`;
}

function buildRoleDescription(code) {
  return `${toTitleCase(code)} role.`;
}

async function upsertPermissions() {
  const permissionDocs = new Map();

  for (const code of permissions) {
    const permission = await Permission.findOneAndUpdate(
      { code },
      {
        $set: {
          name: buildPermissionName(code),
          description: buildPermissionDescription(code),
        },
        $setOnInsert: { code },
      },
      { returnDocument: 'after', upsert: true },
    ).lean();

    permissionDocs.set(code, permission);
  }

  return permissionDocs;
}

async function upsertRoles(permissionDocs) {
  for (const [code, permissionCodes] of Object.entries(rolePermissions)) {
    const permissionIds = permissionCodes.map((permissionCode) => permissionDocs.get(permissionCode)._id);
    const name = code
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

    await Role.findOneAndUpdate(
      { code },
      {
        $set: {
          name: code === roleCodes.LEADER ? leaderRoleName : name,
          code,
          description: buildRoleDescription(code),
          permissions: permissionIds,
        },
      },
      { returnDocument: 'after', upsert: true },
    ).lean();
  }
}

async function seedRbac() {
  await connectDatabase();

  try {
    const permissionDocs = await upsertPermissions();
    await upsertRoles(permissionDocs);
    logger.info('rbac_seed_completed', {
      permissions: permissions.length,
      roles: Object.keys(rolePermissions).length,
    });
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedRbac().catch((error) => {
    logger.error('rbac_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  permissions,
  rolePermissions,
  buildPermissionDescription,
  seedRbac,
  upsertPermissions,
  upsertRoles,
};
