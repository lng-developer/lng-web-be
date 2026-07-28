const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const auditPublic = require('../../modules/audit/public');

let database;
jest.setTimeout(120000);

describe('audit public persistence', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_audit_test'));
    await AuditEvent.init();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  afterEach(async () => AuditEvent.deleteMany({}));

  test('replaying a deduplication key persists one append-only audit outcome', async () => {
    const payload = {
      actorType: 'ACCOUNT',
      actorAccountId: new mongoose.Types.ObjectId(),
      action: 'APPROVED',
      entityType: 'HR_LEAVE_REQUEST',
      entityId: String(new mongoose.Types.ObjectId()),
      outcome: 'SUCCEEDED',
      source: 'SYSTEM',
      metadata: { status: 'APPROVED' },
      deduplicationKey: 'leave:task-5:APPROVED',
    };

    const created = await auditPublic.record(payload);
    const replayed = await auditPublic.record(payload);

    expect(replayed.id).toBe(created.id);
    expect(created).toMatchObject({
      actorType: 'ACCOUNT',
      outcome: 'SUCCEEDED',
      source: 'SYSTEM',
    });
    await expect(AuditEvent.countDocuments({ deduplicationKey: payload.deduplicationKey })).resolves.toBe(1);
  });

  test('replays an existing event inside a transaction without aborting the transaction', async () => {
    const actorAccountId = new mongoose.Types.ObjectId();
    const payload = {
      actorType: 'ACCOUNT',
      actorAccountId,
      action: 'ACCOUNT_UPDATED',
      entityType: 'AUTH_ACCOUNT',
      entityId: String(actorAccountId),
      outcome: 'SUCCEEDED',
      source: 'SYSTEM',
      deduplicationKey: `auth:account:${actorAccountId}:updated`,
    };
    const created = await auditPublic.record(payload);
    const session = await mongoose.startSession();
    let replayed;

    try {
      session.startTransaction();
      replayed = await auditPublic.record(payload, { session });
      await session.commitTransaction();
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }

    expect(replayed.id).toBe(created.id);
    await expect(AuditEvent.countDocuments({ deduplicationKey: payload.deduplicationKey })).resolves.toBe(1);
  });
});
