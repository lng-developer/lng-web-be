const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const TeamMembership = require('../../../modules/organization/models/teamMembership.model');
const repository = require('../../../modules/organization/repositories/teamMembership.repository');

describe('team membership migration repository', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { dbName: 'team_membership_migration_test' } });
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(() => TeamMembership.deleteMany({}));

  it('keeps dry-run read-only and apply idempotent', async () => {
    const item = {
      accountId: new mongoose.Types.ObjectId(),
      teamId: new mongoose.Types.ObjectId(),
      memberType: 'leader',
      status: 'active',
    };

    await expect(repository.migrateLegacyMemberships([item], { apply: false }))
      .resolves.toEqual({ inserted: 0, updated: 0, unchanged: 0, failed: 0 });
    await expect(TeamMembership.countDocuments()).resolves.toBe(0);
    await expect(repository.migrateLegacyMemberships([item], { apply: true }))
      .resolves.toMatchObject({ inserted: 1, failed: 0 });
    await expect(repository.migrateLegacyMemberships([item], { apply: true }))
      .resolves.toMatchObject({ inserted: 0, unchanged: 1, failed: 0 });
    await expect(TeamMembership.countDocuments()).resolves.toBe(1);
  });
});
