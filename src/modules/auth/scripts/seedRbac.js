const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Permission = require('../models/permission.model');
const Role = require('../models/role.model');
const { roleCodes } = require('../constants/auth.constants');

const permissions = [
  'AUTH:READ',
  'AUTH:WRITE',
  'AUDIT:READ',
  'ORDERS:READ',
  'ORDERS:WRITE',
  'CATALOG:READ',
  'CATALOG:WRITE',
  'DESIGN:READ',
  'DESIGN:WRITE',
  'DESIGN:WORK',
  'DESIGN:REVIEW',
  'DEPARTMENTS:READ',
  'DEPARTMENTS:WRITE',
  'INTEGRATION:READ',
  'INTEGRATION:WRITE',
  'MAPPING:READ',
  'MAPPING:WRITE',
  'MEDIA:READ',
  'MEDIA:WRITE',
  'PRODUCTION:READ',
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
];

const rolePermissions = {
  [roleCodes.ADMIN]: permissions,
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
  ],
  [roleCodes.LEADER]: [
    'ORDERS:READ',
    'ORDERS:WRITE',
    'CATALOG:READ',
    'DESIGN:READ',
    'DESIGN:WRITE',
    'DESIGN:WORK',
    'DESIGN:REVIEW',
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
    'REPORTS:READ',
  ],
  [roleCodes.USER]: [
    'ORDERS:READ',
    'ORDERS:WRITE',
    'CATALOG:READ',
    'DESIGN:WORK',
    'MAPPING:READ',
    'MEDIA:READ',
    'PRODUCTION:READ',
    'PRODUCTION:WRITE',
    'SHIPMENTS:READ',
    'SHIPMENTS:WRITE',
    'VENDOR_SUBMISSIONS:READ',
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
          name,
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
