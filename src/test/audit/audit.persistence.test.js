const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const auditPublic = require('../../modules/audit/public');
const { migrateLegacyAuditEvents } = require('../../modules/audit/scripts/migrateLegacyAuditEvents');

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

  test('never invokes a BSON hook that could persist forbidden metadata', async () => {
    const actorAccountId = new mongoose.Types.ObjectId();
    const event = await auditPublic.record({
      actorType: 'ACCOUNT',
      actorAccountId,
      action: 'ACCOUNT_UPDATED',
      entityType: 'AUTH_ACCOUNT',
      entityId: String(actorAccountId),
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      deduplicationKey: `auth:account:${actorAccountId}:bson-hook`,
      metadata: {
        safe: 'keep',
        toBSON() { return { password: 'must-not-persist' }; },
      },
    });

    expect(event.metadata).toEqual({ safe: 'keep' });
    await expect(AuditEvent.findById(event.id).lean()).resolves.toMatchObject({ metadata: { safe: 'keep' } });
  });

  test('model initialization accepts the pre-Task1 unique deduplication index name', async () => {
    const connection = await mongoose.createConnection(
      database.getUri('lng_web_be_audit_legacy_index_test'),
    ).asPromise();
    try {
      await connection.collection('auditevents').createIndex(
        { deduplicationKey: 1 },
        { name: 'deduplicationKey_1', unique: true },
      );
      const CompatAuditEvent = connection.model('AuditEventCompat', AuditEvent.schema, 'auditevents');
      await expect(CompatAuditEvent.init()).resolves.toBeUndefined();
    } finally {
      await connection.close();
    }
  });

  test('preflights and idempotently migrates only proven pre-Task1 audit rows', async () => {
    const actorAccountId = new mongoose.Types.ObjectId();
    const legacy = {
      actorAccountId,
      action: 'APPROVED',
      entityType: 'HR_LEAVE_REQUEST',
      entityId: String(new mongoose.Types.ObjectId()),
      metadata: { status: 'APPROVED' },
      deduplicationKey: `legacy:leave:${new mongoose.Types.ObjectId()}:approved`,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const { insertedId } = await AuditEvent.collection.insertOne(legacy);

    const proof = await migrateLegacyAuditEvents({ apply: false });
    expect(proof).toEqual({
      apply: false,
      legacyCount: 1,
      migratableCount: 1,
      unresolvedCount: 0,
      modifiedCount: 0,
    });
    expect(JSON.stringify(proof)).not.toContain(legacy.deduplicationKey);
    await expect(AuditEvent.collection.findOne({ _id: insertedId }))
      .resolves.not.toHaveProperty('actorType');

    await expect(migrateLegacyAuditEvents({ apply: true })).resolves.toMatchObject({
      apply: true,
      legacyCount: 1,
      migratableCount: 1,
      unresolvedCount: 0,
      modifiedCount: 1,
    });
    await expect(migrateLegacyAuditEvents({ apply: true })).resolves.toMatchObject({
      legacyCount: 0,
      modifiedCount: 0,
    });

    const replayed = await auditPublic.record({
      ...legacy,
      actorType: 'ACCOUNT',
      outcome: 'SUCCEEDED',
      source: 'HTTP',
    });
    expect(replayed).toMatchObject({
      id: String(insertedId),
      actorType: 'ACCOUNT',
      outcome: 'SUCCEEDED',
      source: 'HTTP',
    });
  });

  test('refuses to apply inferred provenance to unproven legacy rows', async () => {
    const deduplicationKey = `legacy:unknown:${new mongoose.Types.ObjectId()}`;
    await AuditEvent.collection.insertOne({
      actorAccountId: new mongoose.Types.ObjectId(),
      action: 'CHANGED',
      entityType: 'UNKNOWN_ENTITY',
      entityId: String(new mongoose.Types.ObjectId()),
      deduplicationKey,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    await expect(migrateLegacyAuditEvents({ apply: false })).resolves.toMatchObject({
      legacyCount: 1,
      migratableCount: 0,
      unresolvedCount: 1,
      modifiedCount: 0,
    });
    await expect(migrateLegacyAuditEvents({ apply: true })).rejects.toThrow(/unresolved legacy audit/i);
    await expect(AuditEvent.collection.findOne({ deduplicationKey }))
      .resolves.not.toHaveProperty('actorType');
  });

  test.each(['toJSON', 'toBSON'])('fails closed before Mongo when Object.prototype.%s is callable', async (hookName) => {
    const actorAccountId = new mongoose.Types.ObjectId();
    const payload = {
      actorType: 'ACCOUNT',
      actorAccountId,
      action: 'ACCOUNT_UPDATED',
      entityType: 'AUTH_ACCOUNT',
      entityId: String(actorAccountId),
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      deduplicationKey: `auth:account:${actorAccountId}:${hookName}`,
      metadata: { safe: 'keep' },
    };
    const original = Object.getOwnPropertyDescriptor(Object.prototype, hookName);
    const hook = jest.fn(() => Object.assign(Object.create(null), { password: 'polluted' }));
    let error;
    Object.defineProperty(Object.prototype, hookName, { configurable: true, value: hook });
    try {
      await auditPublic.record(payload);
    } catch (caught) {
      error = caught;
    } finally {
      if (original) Object.defineProperty(Object.prototype, hookName, original);
      else delete Object.prototype[hookName];
    }

    expect(error).toMatchObject({ isOperational: true, code: 'VALIDATION_ERROR' });
    expect(hook).not.toHaveBeenCalled();
    await expect(AuditEvent.countDocuments({ deduplicationKey: payload.deduplicationKey })).resolves.toBe(0);
  });
});
