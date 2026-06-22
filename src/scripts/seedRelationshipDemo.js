const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../shared/utils/logger');
const { hashPassword } = require('../shared/utils/crypto');
const Account = require('../modules/auth/models/account.model');
const UserProfile = require('../modules/auth/models/userProfile.model');
const Role = require('../modules/auth/models/role.model');
const Permission = require('../modules/auth/models/permission.model');
const AccessAssignment = require('../modules/auth/models/accessAssignment.model');
const ScopedRolePermission = require('../modules/auth/models/scopedRolePermission.model');
const {
  accountStatuses,
  accessAssignmentStatuses,
  accessScopeTypes,
  roleCodes,
} = require('../modules/auth/constants/auth.constants');
const { seedRbac } = require('../modules/auth/scripts/seedRbac');
const { seedDemoUsers, DEMO_PASSWORD } = require('../modules/auth/scripts/seedDemoUsers');
const { seedOrganizationDemo, organizationSeed } = require('./seedOrganizationDemo');
const { seedShopDemo, demoShops } = require('./seedShopDemo');

const RELATIONSHIP_ADMIN = Object.freeze({
  email: 'admin.relationship@demo.lng.co',
  fullName: 'Relationship Demo Admin',
  employeeCode: 'ADM-DEMO',
  password: DEMO_PASSWORD,
});

const relationshipAccounts = Object.freeze([
  {
    label: 'Department Manager',
    employeeCode: 'J2501',
    scope: 'Operations Department',
  },
  {
    label: 'Sales Team Leader',
    employeeCode: 'J2506',
    scope: 'Sales Team',
  },
  {
    label: 'Sales Team Staff',
    employeeCode: 'J2514',
    scope: 'Sales Team',
  },
  {
    label: 'Football Shop Staff',
    employeeCode: 'J2531',
    scope: 'Football US Shop',
  },
]);

const scopedPermissionRules = Object.freeze([
  {
    label: 'Manager override inside Operations Department',
    scopeType: accessScopeTypes.DEPARTMENT,
    scopeId: organizationSeed.department._id,
    roleCode: roleCodes.MANAGER,
    permissionCodes: [
      'AUTH:READ',
      'DEPARTMENTS:READ',
      'TEAMS:READ',
      'TEAMS:WRITE',
    ],
  },
  {
    label: 'Leader override inside Sales Team',
    scopeType: accessScopeTypes.TEAM,
    scopeId: organizationSeed.teams[0]._id,
    roleCode: roleCodes.LEADER,
    permissionCodes: [
      'ORDERS:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
      'TEAMS:READ',
      'TEAMS:WRITE',
    ],
  },
  {
    label: 'Leader override inside Design Team',
    scopeType: accessScopeTypes.TEAM,
    scopeId: organizationSeed.teams[1]._id,
    roleCode: roleCodes.LEADER,
    permissionCodes: [
      'CATALOG:READ',
      'MEDIA:READ',
      'MEDIA:WRITE',
      'TEAMS:READ',
      'TEAMS:WRITE',
    ],
  },
  {
    label: 'User override inside Football US Shop',
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoShops[0]._id,
    roleCode: roleCodes.USER,
    permissionCodes: [
      'ORDERS:READ',
      'CATALOG:READ',
      'SHOPS:READ',
    ],
  },
  {
    label: 'User override inside Pet Memorial Shop',
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoShops[1]._id,
    roleCode: roleCodes.USER,
    permissionCodes: [
      'ORDERS:READ',
      'CATALOG:READ',
      'SHOPS:READ',
    ],
  },
]);

async function loadRolesByCode(codes) {
  const roles = await Role.find({ code: { $in: codes } }).lean();
  const rolesByCode = new Map(roles.map((role) => [role.code, role]));

  for (const code of codes) {
    if (!rolesByCode.has(code)) {
      throw new Error(`${code} role is not configured. Run npm run seed:rbac first.`);
    }
  }

  return rolesByCode;
}

async function loadPermissionsByCode(codes) {
  const permissions = await Permission.find({ code: { $in: codes } }).lean();
  const permissionsByCode = new Map(permissions.map((permission) => [permission.code, permission]));

  for (const code of codes) {
    if (!permissionsByCode.has(code)) {
      throw new Error(`${code} permission is not configured. Run npm run seed:rbac first.`);
    }
  }

  return permissionsByCode;
}

async function upsertRelationshipAdmin(adminRole) {
  const normalizedEmail = RELATIONSHIP_ADMIN.email.toLowerCase();
  const { passwordHash, passwordSalt } = await hashPassword(RELATIONSHIP_ADMIN.password);

  const account = await Account.findOneAndUpdate(
    { normalizedEmail },
    {
      $set: {
        email: normalizedEmail,
        normalizedEmail,
        passwordHash,
        passwordSalt,
        status: accountStatuses.ACTIVE,
      },
      $setOnInsert: {
        sessions: [],
        tokenVersion: 0,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  await UserProfile.findOneAndUpdate(
    {
      $or: [
        { accountId: account._id },
        { email: normalizedEmail },
        { employeeCode: RELATIONSHIP_ADMIN.employeeCode },
      ],
    },
    {
      $set: {
        accountId: account._id,
        email: normalizedEmail,
        fullName: RELATIONSHIP_ADMIN.fullName,
        employeeCode: RELATIONSHIP_ADMIN.employeeCode,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  await AccessAssignment.findOneAndUpdate(
    {
      accountId: account._id,
      roleId: adminRole._id,
      scopeType: accessScopeTypes.GLOBAL,
      scopeId: null,
      status: accessAssignmentStatuses.ACTIVE,
    },
    {
      $setOnInsert: {
        accountId: account._id,
        roleId: adminRole._id,
        scopeType: accessScopeTypes.GLOBAL,
        scopeId: null,
        customPermissions: [],
        status: accessAssignmentStatuses.ACTIVE,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  return account;
}

async function upsertScopedRolePermissions() {
  const roleCodesToLoad = [...new Set(scopedPermissionRules.map((rule) => rule.roleCode))];
  const permissionCodesToLoad = [
    ...new Set(scopedPermissionRules.flatMap((rule) => rule.permissionCodes)),
  ];
  const [rolesByCode, permissionsByCode] = await Promise.all([
    loadRolesByCode(roleCodesToLoad),
    loadPermissionsByCode(permissionCodesToLoad),
  ]);

  for (const rule of scopedPermissionRules) {
    const permissions = rule.permissionCodes.map((code) => permissionsByCode.get(code)._id);

    await ScopedRolePermission.findOneAndUpdate(
      {
        scopeType: rule.scopeType,
        scopeId: new mongoose.Types.ObjectId(rule.scopeId),
        roleId: rolesByCode.get(rule.roleCode)._id,
      },
      {
        $set: {
          permissions,
        },
        $setOnInsert: {
          scopeType: rule.scopeType,
          scopeId: new mongoose.Types.ObjectId(rule.scopeId),
          roleId: rolesByCode.get(rule.roleCode)._id,
        },
      },
      {
        returnDocument: 'after',
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();
  }
}

async function countCollections() {
  const collections = [
    'accounts',
    'userprofiles',
    'roles',
    'permissions',
    'accessassignments',
    'scopedrolepermissions',
    'departments',
    'teams',
    'teammemberships',
    'shops',
    'scoperegistries',
  ];
  const result = {};

  for (const collection of collections) {
    result[collection] = await mongoose.connection.db
      .collection(collection)
      .countDocuments({});
  }

  return result;
}

async function buildRelationshipSummary(adminAccount) {
  const employeeCodes = relationshipAccounts.map((account) => account.employeeCode);
  const profiles = await UserProfile.find({
    employeeCode: { $in: [...employeeCodes, RELATIONSHIP_ADMIN.employeeCode] },
  })
    .select('accountId email fullName employeeCode')
    .lean();
  const profilesByEmployeeCode = new Map(
    profiles.map((profile) => [profile.employeeCode, profile]),
  );

  return {
    database: mongoose.connection.db.databaseName,
    defaultPassword: DEMO_PASSWORD,
    admin: {
      email: RELATIONSHIP_ADMIN.email,
      employeeCode: RELATIONSHIP_ADMIN.employeeCode,
      accountId: String(adminAccount._id),
      scopeType: accessScopeTypes.GLOBAL,
    },
    organization: {
      department: organizationSeed.department,
      teams: organizationSeed.teams,
    },
    shops: demoShops.map((shop) => ({
      id: shop._id,
      name: shop.name,
      status: shop.status,
    })),
    accountsToInspect: relationshipAccounts.map((account) => {
      const profile = profilesByEmployeeCode.get(account.employeeCode);

      return {
        ...account,
        email: profile ? profile.email : null,
        accountId: profile ? String(profile.accountId) : null,
      };
    }),
    scopedRolePermissionRules: scopedPermissionRules.map((rule) => ({
      label: rule.label,
      scopeType: rule.scopeType,
      scopeId: rule.scopeId,
      roleCode: rule.roleCode,
      permissionCodes: rule.permissionCodes,
    })),
    counts: await countCollections(),
  };
}

async function seedRelationshipDemo() {
  await seedRbac();
  await seedDemoUsers();
  await seedOrganizationDemo();
  await seedShopDemo();

  await connectDatabase();

  try {
    const rolesByCode = await loadRolesByCode([roleCodes.ADMIN]);
    const adminAccount = await upsertRelationshipAdmin(rolesByCode.get(roleCodes.ADMIN));
    await upsertScopedRolePermissions();

    const summary = await buildRelationshipSummary(adminAccount);

    logger.info('relationship_demo_seed_completed', summary);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

    return summary;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedRelationshipDemo().catch((error) => {
    logger.error('relationship_demo_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  RELATIONSHIP_ADMIN,
  relationshipAccounts,
  scopedPermissionRules,
  seedRelationshipDemo,
};
