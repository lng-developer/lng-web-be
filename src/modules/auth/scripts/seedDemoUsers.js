const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const { hashPassword } = require('../../../shared/utils/crypto');
const Account = require('../models/account.model');
const UserProfile = require('../models/userProfile.model');
const Role = require('../models/role.model');
const AccessAssignment = require('../models/accessAssignment.model');
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
  amazonShop: '660000000000000000000201',
  etsyShop: '660000000000000000000202',
});

function toEmployeeCode(index) {
  return `J${2500 + index}`;
}

function toDemoEmail(employeeCode) {
  return `${employeeCode.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`;
}

function buildUser(index, roleCode, scopeType, scopeId, title, groupName) {
  const employeeCode = toEmployeeCode(index);

  return {
    employeeCode,
    email: toDemoEmail(employeeCode),
    fullName: `${employeeCode} ${title}`,
    roleCode,
    scopeType,
    scopeId,
    groupName,
  };
}

function buildDemoUsers() {
  const users = [];
  let index = 1;

  for (let count = 0; count < 5; count += 1) {
    users.push(buildUser(
      index,
      roleCodes.DEPARTMENT_MANAGER,
      accessScopeTypes.DEPARTMENT,
      demoScopeIds.operationsDepartment,
      'Operations Department Manager',
      'Operations Department',
    ));
    index += 1;
  }

  for (let count = 0; count < 4; count += 1) {
    users.push(buildUser(
      index,
      roleCodes.TEAM_LEADER,
      accessScopeTypes.TEAM,
      demoScopeIds.salesTeam,
      'Sales Team Leader',
      'Sales Team',
    ));
    index += 1;
  }

  for (let count = 0; count < 4; count += 1) {
    users.push(buildUser(
      index,
      roleCodes.TEAM_LEADER,
      accessScopeTypes.TEAM,
      demoScopeIds.designTeam,
      'Design Team Leader',
      'Design Team',
    ));
    index += 1;
  }

  for (let count = 0; count < 9; count += 1) {
    users.push(buildUser(
      index,
      roleCodes.OPERATOR,
      accessScopeTypes.TEAM,
      demoScopeIds.salesTeam,
      'Sales Operator',
      'Sales Team',
    ));
    index += 1;
  }

  for (let count = 0; count < 8; count += 1) {
    users.push(buildUser(
      index,
      roleCodes.OPERATOR,
      accessScopeTypes.TEAM,
      demoScopeIds.designTeam,
      'Design Operator',
      'Design Team',
    ));
    index += 1;
  }

  for (let count = 0; count < 5; count += 1) {
    users.push(buildUser(
      index,
      roleCodes.OPERATOR,
      accessScopeTypes.SHOP,
      demoScopeIds.amazonShop,
      'Amazon Shop Operator',
      'Amazon US - Main',
    ));
    index += 1;
  }

  for (let count = 0; count < 5; count += 1) {
    users.push(buildUser(
      index,
      roleCodes.OPERATOR,
      accessScopeTypes.SHOP,
      demoScopeIds.etsyShop,
      'Etsy Shop Operator',
      'Etsy - Handmade',
    ));
    index += 1;
  }

  return users;
}

async function loadRolesByCode() {
  const roleDocs = await Role.find({
    code: {
      $in: [
        roleCodes.DEPARTMENT_MANAGER,
        roleCodes.TEAM_LEADER,
        roleCodes.OPERATOR,
      ],
    },
  }).lean();

  const rolesByCode = new Map(roleDocs.map((role) => [role.code, role]));

  for (const roleCode of [roleCodes.DEPARTMENT_MANAGER, roleCodes.TEAM_LEADER, roleCodes.OPERATOR]) {
    if (!rolesByCode.has(roleCode)) {
      throw new Error(`${roleCode} role is not configured. Run npm run seed:rbac first.`);
    }
  }

  return rolesByCode;
}

async function upsertAccount(user, passwordHash, passwordSalt, session) {
  return Account.findOneAndUpdate(
    { normalizedEmail: user.email },
    {
      $set: {
        email: user.email,
        normalizedEmail: user.email,
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
    },
  );
}

async function upsertProfile(user, accountId, session) {
  return UserProfile.findOneAndUpdate(
    { accountId },
    {
      $set: {
        accountId,
        email: user.email,
        fullName: user.fullName,
        employeeCode: user.employeeCode,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
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

  return AccessAssignment.findOneAndUpdate(
    {
      accountId,
      roleId,
      scopeType: user.scopeType,
      scopeId: user.scopeId,
      status: accessAssignmentStatuses.ACTIVE,
    },
    {
      $setOnInsert: {
        accountId,
        roleId,
        scopeType: user.scopeType,
        scopeId: user.scopeId,
        customPermissions: [],
        status: accessAssignmentStatuses.ACTIVE,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  );
}

async function seedOneUser(user, role, passwordHash, passwordSalt) {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const account = await upsertAccount(user, passwordHash, passwordSalt, session);
      await upsertProfile(user, account._id, session);
      await upsertScopedAssignment(account._id, role._id, user, session);
    });
  } finally {
    await session.endSession();
  }
}

async function seedDemoUsers() {
  await connectDatabase();

  try {
    await upsertDemoScopes();

    const users = buildDemoUsers();
    const rolesByCode = await loadRolesByCode();
    const { passwordHash, passwordSalt } = await hashPassword(DEMO_PASSWORD);

    for (const user of users) {
      await seedOneUser(user, rolesByCode.get(user.roleCode), passwordHash, passwordSalt);
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
  seedDemoUsers,
};
