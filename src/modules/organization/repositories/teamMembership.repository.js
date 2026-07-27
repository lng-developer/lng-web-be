const mongoose = require('mongoose');
const { organizationStatuses } = require('../constants');
const TeamMembership = require('../models/teamMembership.model');

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
}

async function upsertActive(payload, { session } = {}) {
  return TeamMembership.findOneAndUpdate(
    {
      accountId: payload.accountId,
      teamId: payload.teamId,
    },
    {
      $set: {
        memberType: payload.memberType,
        status: organizationStatuses.ACTIVE,
      },
      $setOnInsert: {
        accountId: payload.accountId,
        teamId: payload.teamId,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  ).lean();
}

async function findActiveByAccountId(accountId, { session } = {}) {
  return TeamMembership.findOne({
    accountId,
    status: organizationStatuses.ACTIVE,
  })
    .session(session || null)
    .lean();
}

async function findActiveByTeamAndAccount(teamId, accountId, { session } = {}) {
  return TeamMembership.findOne({
    teamId,
    accountId,
    status: organizationStatuses.ACTIVE,
  })
    .session(session || null)
    .lean();
}

async function deactivateActiveByAccountId(accountId, { session } = {}) {
  return TeamMembership.updateMany(
    {
      accountId,
      status: organizationStatuses.ACTIVE,
    },
    {
      $set: {
        status: organizationStatuses.INACTIVE,
      },
    },
    {
      runValidators: true,
      session,
    },
  );
}

async function deactivate(teamId, accountId, { session } = {}) {
  return TeamMembership.findOneAndUpdate(
    {
      teamId,
      accountId,
      status: organizationStatuses.ACTIVE,
    },
    {
      $set: {
        status: organizationStatuses.INACTIVE,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
      session,
    },
  ).lean();
}

async function listActiveByTeam(teamId) {
  return TeamMembership.find({
    teamId,
    status: organizationStatuses.ACTIVE,
  })
    .sort({ memberType: 1, createdAt: 1 })
    .lean();
}

async function listActiveAccountIds() {
  const memberships = await TeamMembership.find({
    status: organizationStatuses.ACTIVE,
  })
    .select('accountId')
    .lean();

  return memberships.map((membership) => membership.accountId);
}

async function listActiveOrganizationByAccountIds(accountIds = []) {
  const uniqueAccountIds = [...new Set(accountIds.map((accountId) => String(accountId)))];

  if (uniqueAccountIds.length === 0) {
    return [];
  }

  return TeamMembership.aggregate([
    {
      $match: {
        accountId: { $in: uniqueAccountIds.map(toObjectId) },
        status: organizationStatuses.ACTIVE,
      },
    },
    {
      $lookup: {
        from: 'teams',
        localField: 'teamId',
        foreignField: '_id',
        as: 'team',
      },
    },
    { $unwind: { path: '$team', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'departments',
        localField: 'team.departmentId',
        foreignField: '_id',
        as: 'department',
      },
    },
    { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        accountId: 1,
        memberType: 1,
        team: {
          id: '$team._id',
          name: '$team.name',
          code: '$team.code',
          status: '$team.status',
        },
        department: {
          id: '$department._id',
          name: '$department.name',
          code: '$department.code',
          status: '$department.status',
        },
      },
    },
  ]);
}

async function migrateLegacyMemberships(items = [], { apply = false } = {}) {
  if (!apply || items.length === 0) return { inserted: 0, updated: 0, unchanged: 0, failed: 0, skippedRows: [] };
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const skippedRows = [];
  for (const item of items) {
    const session = await mongoose.startSession();
    try {
      let outcome;
      await session.withTransaction(async () => {
        const existing = await TeamMembership.findOne({ accountId: item.accountId, teamId: item.teamId })
          .session(session)
          .lean();
        if (existing?.memberType === item.memberType && existing.status === organizationStatuses.ACTIVE) {
          outcome = 'unchanged';
          return;
        }
        await deactivateActiveByAccountId(item.accountId, { session });
        await upsertActive(item, { session });
        outcome = existing ? 'updated' : 'inserted';
      });
      if (outcome === 'inserted') inserted += 1;
      else if (outcome === 'updated') updated += 1;
      else unchanged += 1;
    } catch (error) {
      failed += 1;
      skippedRows.push({
        sourceId: String(item.sourceId),
        reasonCode: 'TEAM_MEMBERSHIP_WRITE_FAILED',
        detail: error?.name === 'ValidationError' ? 'VALIDATION_ERROR' : 'WRITE_ERROR',
      });
    } finally {
      await session.endSession();
    }
  }
  return { inserted, updated, unchanged, failed, skippedRows };
}

module.exports = {
  upsertActive,
  findActiveByAccountId,
  findActiveByTeamAndAccount,
  deactivateActiveByAccountId,
  deactivate,
  listActiveByTeam,
  listActiveAccountIds,
  listActiveOrganizationByAccountIds,
  migrateLegacyMemberships,
};
