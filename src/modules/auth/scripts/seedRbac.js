const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Permission = require('../models/permission.model');
const Role = require('../models/role.model');
const { roleCodes } = require('../constants/auth.constants');

const permissions = [
  'AUTH:READ',
  'AUTH:WRITE',
  'ORDERS:READ',
  'ORDERS:WRITE',
  'CATALOG:READ',
  'CATALOG:WRITE',
  'MAPPING:READ',
  'MAPPING:WRITE',
  'PRODUCTION:READ',
  'PRODUCTION:WRITE',
  'VENDORS:READ',
  'VENDORS:WRITE',
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
    'ORDERS:READ',
    'ORDERS:WRITE',
    'CATALOG:READ',
    'MAPPING:READ',
    'PRODUCTION:READ',
    'PRODUCTION:WRITE',
    'VENDORS:READ',
    'SHIPMENTS:READ',
    'SHIPMENTS:WRITE',
    'FINANCE:READ',
    'REPORTS:READ',
  ],
  [roleCodes.OPERATOR]: [
    'ORDERS:READ',
    'CATALOG:READ',
    'MAPPING:READ',
    'PRODUCTION:READ',
    'SHIPMENTS:READ',
  ],
};

async function upsertPermissions() {
  const permissionDocs = new Map();

  for (const code of permissions) {
    const permission = await Permission.findOneAndUpdate(
      { code },
      { $setOnInsert: { code } },
      { new: true, upsert: true },
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
          permissions: permissionIds,
        },
      },
      { new: true, upsert: true },
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

seedRbac().catch((error) => {
  logger.error('rbac_seed_failed', { error });
  process.exit(1);
});
