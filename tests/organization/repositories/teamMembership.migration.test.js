const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const TeamMembership = require('../../../src/modules/organization/models/teamMembership.model');
const repository = require('../../../src/modules/organization/repositories/teamMembership.repository');

describe('team membership migration repository', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ dbName: 'team_membership_migration_test' }] });
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(() => TeamMembership.deleteMany({}));

  it('keeps dry-run read-only and apply idempotent', async () => {
    const item = {
      sourceId: 'legacy-employee-1',
      accountId: new mongoose.Types.ObjectId(),
      teamId: new mongoose.Types.ObjectId(),
      memberType: 'leader',
      status: 'active',
    };

    await expect(repository.migrateLegacyMemberships([item], { apply: false }))
      .resolves.toEqual({ inserted: 0, updated: 0, unchanged: 0, failed: 0, skippedRows: [] });
    await expect(TeamMembership.countDocuments()).resolves.toBe(0);
    await expect(repository.migrateLegacyMemberships([item], { apply: true }))
      .resolves.toMatchObject({ inserted: 1, failed: 0 });
    await expect(repository.migrateLegacyMemberships([item], { apply: true }))
      .resolves.toMatchObject({ inserted: 0, unchanged: 1, failed: 0 });
    await expect(TeamMembership.countDocuments()).resolves.toBe(1);
  });

  it('rolls back the old membership and reports the source row when replacement fails', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const oldTeamId = new mongoose.Types.ObjectId();
    const nextTeamId = new mongoose.Types.ObjectId();
    await TeamMembership.create({ accountId, teamId: oldTeamId, memberType: 'member', status: 'active' });

    const result = await repository.migrateLegacyMemberships([{
      sourceId: 'legacy-employee-2',
      accountId,
      teamId: nextTeamId,
      memberType: 'INVALID',
    }], { apply: true });

    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 0, failed: 1 });
    expect(result.skippedRows).toEqual([{
      sourceId: 'legacy-employee-2',
      reasonCode: 'TEAM_MEMBERSHIP_WRITE_FAILED',
      detail: 'VALIDATION_ERROR',
    }]);
    await expect(TeamMembership.findOne({ accountId, status: 'active' }).lean())
      .resolves.toMatchObject({ teamId: oldTeamId });
  });
});
