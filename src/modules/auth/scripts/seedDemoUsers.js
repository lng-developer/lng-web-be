const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const { hashPassword } = require('../../../shared/utils/crypto');
const Account = require('../models/account.model');
const Role = require('../models/role.model');
const Permission = require('../models/permission.model');
const AccessAssignment = require('../models/accessAssignment.model');
const ScopedRolePermission = require('../models/scopedRolePermission.model');
const {
  accountStatuses,
  accessAssignmentStatuses,
  accessScopeTypes,
  roleCodes,
} = require('../constants/auth.constants');
const { upsertDemoScopes } = require('./seedDemoScopes');

const DEMO_PASSWORD = 'Demo@123456';
const DEMO_EMAIL_DOMAIN = 'demo.lng.co';

const demoScopeIds = Object.freeze({
  operationsDepartment: '660000000000000000000001',
  salesTeam: '660000000000000000000101',
  designTeam: '660000000000000000000102',
  footballShop: '660000000000000000000201',
  petMemorialShop: '660000000000000000000202',
});

const scopedPermissionRules = Object.freeze([
  {
    label: 'Operations manager',
    scopeType: accessScopeTypes.DEPARTMENT,
    scopeId: demoScopeIds.operationsDepartment,
    roleCode: roleCodes.MANAGER,
    permissionCodes: [
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
      'MAPPING:READ',
      'MEDIA:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
      'SHOPS:READ',
      'TEAMS:READ',
      'TEAMS:WRITE',
      'VENDORS:READ',
      'VENDOR_SUBMISSIONS:READ',
      'SHIPMENTS:READ',
      'FINANCE:READ',
      'REPORTS:READ',
    ],
  },
  {
    label: 'Sales leader',
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.salesTeam,
    roleCode: roleCodes.LEADER,
    permissionCodes: [
      'ORDERS:READ',
      'ORDERS:WRITE',
      'CATALOG:READ',
      'MAPPING:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
      'SHOPS:READ',
      'TEAMS:READ',
      'TEAMS:WRITE',
      'VENDOR_SUBMISSIONS:READ',
      'SHIPMENTS:READ',
      'REPORTS:READ',
    ],
  },
  {
    label: 'Design QC lead',
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.designTeam,
    roleCode: roleCodes.LEADER,
    permissionCodes: [
      'CATALOG:READ',
      'DESIGN:READ',
      'DESIGN:WRITE',
      'DESIGN:WORK',
      'DESIGN:REVIEW',
      'WORK_SCORES:READ',
      'WORK_SCORES:ADJUST',
      'MEDIA:READ',
      'MEDIA:WRITE',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
      'TEAMS:READ',
    ],
  },
  {
    label: 'Sales staff',
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.salesTeam,
    roleCode: roleCodes.USER,
    permissionCodes: [
      'ORDERS:READ',
      'ORDERS:WRITE',
      'CATALOG:READ',
      'MAPPING:READ',
      'SHOPS:READ',
    ],
  },
  {
    label: 'Scale designer',
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.designTeam,
    roleCode: roleCodes.USER,
    permissionCodes: [
      'CATALOG:READ',
      'DESIGN:WORK',
      'MEDIA:READ',
      'MEDIA:WRITE',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
    ],
  },
  {
    label: 'Football shop seller',
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoScopeIds.footballShop,
    roleCode: roleCodes.USER,
    permissionCodes: [
      'ORDERS:READ',
      'CATALOG:READ',
      'SHOPS:READ',
    ],
  },
  {
    label: 'Pet shop seller',
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoScopeIds.petMemorialShop,
    roleCode: roleCodes.USER,
    permissionCodes: [
      'ORDERS:READ',
      'CATALOG:READ',
      'SHOPS:READ',
    ],
  },
]);

const demoUserDefinitions = Object.freeze([
  {
    employeeCode: 'J2501',
    title: 'Operations Department Manager',
    roleCode: roleCodes.MANAGER,
    scopeType: accessScopeTypes.DEPARTMENT,
    scopeId: demoScopeIds.operationsDepartment,
    groupName: 'Operations Department',
  },
  {
    employeeCode: 'J2506',
    title: 'Sales Team Leader',
    roleCode: roleCodes.LEADER,
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.salesTeam,
    groupName: 'Sales Team',
  },
  {
    employeeCode: 'J2510',
    title: 'Design QC Lead',
    roleCode: roleCodes.LEADER,
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.designTeam,
    groupName: 'Design Team',
  },
  {
    employeeCode: 'J2514',
    title: 'Sales Operator',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.salesTeam,
    groupName: 'Sales Team',
  },
  {
    employeeCode: 'J2515',
    title: 'CS Production Coordinator',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.salesTeam,
    groupName: 'Sales Team',
    overridePermissionCodes: [
      'ORDERS:READ',
      'CATALOG:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
      'SHOPS:READ',
    ],
  },
  {
    employeeCode: 'J2523',
    title: 'Scale Designer',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.designTeam,
    groupName: 'Design Team',
  },
  {
    employeeCode: 'J2524',
    title: 'Design QC Reviewer',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.TEAM,
    scopeId: demoScopeIds.designTeam,
    groupName: 'Design Team',
    overridePermissionCodes: [
      'CATALOG:READ',
      'DESIGN:READ',
      'DESIGN:REVIEW',
      'MEDIA:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
    ],
  },
  {
    employeeCode: 'J2531',
    title: 'Football Shop Operator',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoScopeIds.footballShop,
    groupName: 'Football US Shop',
  },
  {
    employeeCode: 'J2532',
    title: 'Football Scale Designer',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoScopeIds.footballShop,
    groupName: 'Football US Shop',
    overridePermissionCodes: [
      'CATALOG:READ',
      'DESIGN:WORK',
      'MEDIA:READ',
      'MEDIA:WRITE',
      'PRODUCTION:READ',
    ],
  },
  {
    employeeCode: 'J2533',
    title: 'Football QC Reviewer',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoScopeIds.footballShop,
    groupName: 'Football US Shop',
    overridePermissionCodes: [
      'CATALOG:READ',
      'DESIGN:REVIEW',
      'MEDIA:READ',
      'PRODUCTION:READ',
    ],
  },
  {
    employeeCode: 'J2534',
    title: 'Football Production CS',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoScopeIds.footballShop,
    groupName: 'Football US Shop',
    overridePermissionCodes: [
      'ORDERS:READ',
      'CATALOG:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
      'SHOPS:READ',
    ],
  },
  {
    employeeCode: 'J2536',
    title: 'Pet Memorial Shop Operator',
    roleCode: roleCodes.USER,
    scopeType: accessScopeTypes.SHOP,
    scopeId: demoScopeIds.petMemorialShop,
    groupName: 'Pet Memorial Shop',
  },
]);

function buildTeamMemberDefinitions() {
  const ranges = [
    [2506, 2509, demoScopeIds.salesTeam, 'Sales Team'],
    [2510, 2513, demoScopeIds.designTeam, 'Design Team'],
    [2514, 2522, demoScopeIds.salesTeam, 'Sales Team'],
    [2523, 2530, demoScopeIds.designTeam, 'Design Team'],
  ];

  return ranges.flatMap(([from, to, scopeId, groupName]) => Array.from(
    { length: to - from + 1 },
    (_, index) => ({
      employeeCode: `J${from + index}`,
      title: `${groupName} Member`,
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.TEAM,
      scopeId,
      groupName,
    }),
  ));
}

function toDemoEmail(employeeCode) {
  return `${employeeCode.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`;
}

function buildUser(definition) {
  return {
    ...definition,
    email: toDemoEmail(definition.employeeCode),
    fullName: `${definition.employeeCode} ${definition.title}`,
  };
}

function buildDemoUsers() {
  const definitionsByCode = new Map(
    [...buildTeamMemberDefinitions(), ...demoUserDefinitions]
      .map((definition) => [definition.employeeCode, definition]),
  );

  return [...definitionsByCode.values()]
    .sort((left, right) => left.employeeCode.localeCompare(right.employeeCode))
    .map(buildUser);
}

async function loadPermissionsByCode(codes) {
  const uniqueCodes = [...new Set(codes)];
  if (!uniqueCodes.length) return new Map();

  const permissionDocs = await Permission.find({ code: { $in: uniqueCodes } }).lean();
  const permissionsByCode = new Map(permissionDocs.map((permission) => [permission.code, permission]));

  for (const code of uniqueCodes) {
    if (!permissionsByCode.has(code)) {
      throw new Error(`${code} permission is not configured. Run npm run seed:rbac first.`);
    }
  }

  return permissionsByCode;
}

async function upsertScopedRolePermissions(rolesByCode) {
  const permissionsByCode = await loadPermissionsByCode(
    scopedPermissionRules.flatMap((rule) => rule.permissionCodes),
  );

  for (const rule of scopedPermissionRules) {
    const scopeId = new mongoose.Types.ObjectId(rule.scopeId);

    await ScopedRolePermission.findOneAndUpdate(
      {
        scopeType: rule.scopeType,
        scopeId,
        roleId: rolesByCode.get(rule.roleCode)._id,
      },
      {
        $set: {
          permissions: rule.permissionCodes.map((code) => permissionsByCode.get(code)._id),
        },
        $setOnInsert: {
          scopeType: rule.scopeType,
          scopeId,
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

async function withOverridePermissionIds(user, permissionsByCode) {
  if (!user.overridePermissionCodes?.length) return user;
  return {
    ...user,
    overridePermissionIds: user.overridePermissionCodes.map((code) => permissionsByCode.get(code)._id),
  };
}


async function loadRolesByCode() {
  const roleDocs = await Role.find({
    code: {
      $in: [
        roleCodes.MANAGER,
        roleCodes.LEADER,
        roleCodes.USER,
      ],
    },
  }).lean();

  const rolesByCode = new Map(roleDocs.map((role) => [role.code, role]));

  for (const roleCode of [roleCodes.MANAGER, roleCodes.LEADER, roleCodes.USER]) {
    if (!rolesByCode.has(roleCode)) {
      throw new Error(`${roleCode} role is not configured. Run npm run seed:rbac first.`);
    }
  }

  return rolesByCode;
}

async function upsertAccount(user, passwordHash, passwordSalt, session) {
  const normalizedEmail = user.email.toLowerCase();

  return Account.findOneAndUpdate(
    { email: user.email },
    {
      $set: {
        email: user.email,
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
      session,
      strict: false,
    },
  );
}

async function upsertScopedAssignment(accountId, roleId, user, session) {
  await AccessAssignment.updateMany(
    {
      accountId,
      status: accessAssignmentStatuses.ACTIVE,
      $or: [
        { roleId: { $ne: roleId } },
        { scopeType: { $ne: user.scopeType } },
        { scopeId: { $ne: user.scopeId } },
      ],
    },
    {
      $set: {
        status: accessAssignmentStatuses.INACTIVE,
      },
    },
    {
      runValidators: true,
      session,
    },
  );

  const update = {
    $setOnInsert: {
      accountId,
      roleId,
      scopeType: user.scopeType,
      scopeId: user.scopeId,
      customPermissions: [],
      status: accessAssignmentStatuses.ACTIVE,
    },
  };

  if (user.overridePermissionIds) {
    update.$set = { overridePermissions: user.overridePermissionIds };
  } else {
    update.$unset = { overridePermissions: '' };
  }

  return AccessAssignment.findOneAndUpdate(
    {
      accountId,
      roleId,
      scopeType: user.scopeType,
      scopeId: user.scopeId,
      status: accessAssignmentStatuses.ACTIVE,
    },
    update,
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  );
}

async function seedOneUser(user, role, permissionsByCode, passwordHash, passwordSalt) {
  const userWithOverrideIds = await withOverridePermissionIds(user, permissionsByCode);

  const account = await upsertAccount(userWithOverrideIds, passwordHash, passwordSalt);
  await upsertScopedAssignment(account._id, role._id, userWithOverrideIds);
}

async function seedDemoUsers() {
  await connectDatabase();

  try {
    await upsertDemoScopes();

    const users = buildDemoUsers();
    const rolesByCode = await loadRolesByCode();
    const permissionsByCode = await loadPermissionsByCode(
      users.flatMap((user) => user.overridePermissionCodes || []),
    );
    const { passwordHash, passwordSalt } = await hashPassword(DEMO_PASSWORD);

    await upsertScopedRolePermissions(rolesByCode);

    for (const user of users) {
      await seedOneUser(user, rolesByCode.get(user.roleCode), permissionsByCode, passwordHash, passwordSalt);
    }

    logger.info('rbac_demo_users_seed_completed', {
      users: users.length,
      employeeCodeFrom: users[0].employeeCode,
      employeeCodeTo: users[users.length - 1].employeeCode,
      defaultPassword: DEMO_PASSWORD,
    });
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedDemoUsers().catch((error) => {
    logger.error('rbac_demo_users_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  DEMO_PASSWORD,
  buildDemoUsers,
  scopedPermissionRules,
  seedDemoUsers,
  upsertScopedRolePermissions,
};
