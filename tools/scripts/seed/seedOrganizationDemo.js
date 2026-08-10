const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');
const Department = require('../../../src/modules/organization/models/department.model');
const Team = require('../../../src/modules/organization/models/team.model');
const TeamMembership = require('../../../src/modules/organization/models/teamMembership.model');
const EmployeeProfile = require('../../../src/modules/hr/models/employeeProfile.model');
const { syncOrganizationScopes } = require('./syncOrganizationScopes');
const { repairTeamMemberships } = require('./repairTeamMemberships');
const {
  organizationStatuses,
  teamMemberTypes,
} = require('../../../src/modules/organization/constants');

const operationsDepartmentId = '660000000000000000000001';
const salesTeamId = '660000000000000000000101';
const designTeamId = '660000000000000000000102';

const organizationSeed = {
  department: {
    _id: operationsDepartmentId,
    name: 'Operations Department',
    code: 'OPERATIONS',
  },
  teams: [
    {
      _id: salesTeamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId: operationsDepartmentId,
    },
    {
      _id: designTeamId,
      name: 'Design Team',
      code: 'DESIGN',
      departmentId: operationsDepartmentId,
    },
  ],
};

function range(start, end) {
  const values = [];

  for (let value = start; value <= end; value += 1) {
    values.push(`J${value}`);
  }

  return values;
}

const membershipSeed = [
  ...range(2506, 2509).map((employeeCode) => ({
    employeeCode,
    teamId: salesTeamId,
    memberType: teamMemberTypes.LEADER,
  })),
  ...range(2510, 2513).map((employeeCode) => ({
    employeeCode,
    teamId: designTeamId,
    memberType: teamMemberTypes.LEADER,
  })),
  ...range(2514, 2522).map((employeeCode) => ({
    employeeCode,
    teamId: salesTeamId,
    memberType: teamMemberTypes.MEMBER,
  })),
  ...range(2523, 2530).map((employeeCode) => ({
    employeeCode,
    teamId: designTeamId,
    memberType: teamMemberTypes.MEMBER,
  })),
];

async function upsertDepartment() {
  return Department.findOneAndUpdate(
    { _id: organizationSeed.department._id },
    {
      $set: {
        name: organizationSeed.department.name,
        code: organizationSeed.department.code,
        status: organizationStatuses.ACTIVE,
      },
      $setOnInsert: {
        _id: new mongoose.Types.ObjectId(organizationSeed.department._id),
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

async function upsertTeams() {
  for (const team of organizationSeed.teams) {
    await Team.findOneAndUpdate(
      { _id: team._id },
      {
        $set: {
          name: team.name,
          code: team.code,
          departmentId: team.departmentId,
          status: organizationStatuses.ACTIVE,
        },
        $setOnInsert: {
          _id: new mongoose.Types.ObjectId(team._id),
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

async function upsertMemberships() {
  const employeeCodes = membershipSeed.map((membership) => membership.employeeCode);
  const profiles = await EmployeeProfile.find({ employeeCode: { $in: employeeCodes }, isDeleted: false })
    .select('accountId employeeCode')
    .lean();
  const profilesByEmployeeCode = new Map(profiles.map((profile) => [profile.employeeCode, profile]));

  for (const membership of membershipSeed) {
    const profile = profilesByEmployeeCode.get(membership.employeeCode);

    if (!profile) {
      throw new Error(`Missing demo user profile for ${membership.employeeCode}. Run npm run seed:auth:demo-users first.`);
    }

    await TeamMembership.updateMany(
      {
        accountId: profile.accountId,
        status: organizationStatuses.ACTIVE,
      },
      {
        $set: {
          status: organizationStatuses.INACTIVE,
        },
      },
      {
        runValidators: true,
      },
    );

    await TeamMembership.findOneAndUpdate(
      {
        accountId: profile.accountId,
        teamId: membership.teamId,
      },
      {
        $set: {
          memberType: membership.memberType,
          status: organizationStatuses.ACTIVE,
        },
        $setOnInsert: {
          accountId: profile.accountId,
          teamId: membership.teamId,
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

async function seedOrganizationDemo() {
  await connectDatabase();

  try {
    await upsertDepartment();
    await upsertTeams();
    await syncOrganizationScopes({ manageConnection: false });
    await repairTeamMemberships({ manageConnection: false });
    await upsertMemberships();
    await repairTeamMemberships({ manageConnection: false });

    logger.info('organization_demo_seed_completed', {
      departments: 1,
      teams: organizationSeed.teams.length,
      memberships: membershipSeed.length,
    });
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedOrganizationDemo().catch((error) => {
    logger.error('organization_demo_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  organizationSeed,
  membershipSeed,
  seedOrganizationDemo,
  upsertDepartment,
  upsertTeams,
  upsertMemberships,
};
