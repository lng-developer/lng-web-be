const mongoose = require('mongoose');
const { startIsolatedMongo } = require('../helpers/isolatedMongo');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const auditPublic = require('../../modules/audit/public');

let database;
jest.setTimeout(120000);

describe('audit public persistence', () => {
  beforeAll(async () => {
    database = await startIsolatedMongo('lng_web_be_task5_audit_test');
    await AuditEvent.init();
  });

  afterAll(async () => database.stop());

  afterEach(async () => AuditEvent.deleteMany({}));

  test('replaying a deduplication key persists one append-only audit outcome', async () => {
    const payload = {
      actorAccountId: new mongoose.Types.ObjectId(),
      action: 'APPROVED',
      entityType: 'HR_LEAVE_REQUEST',
      entityId: String(new mongoose.Types.ObjectId()),
      metadata: { status: 'APPROVED' },
      deduplicationKey: 'leave:task-5:APPROVED',
    };

    const created = await auditPublic.record(payload);
    const replayed = await auditPublic.record(payload);

    expect(replayed.id).toBe(created.id);
    await expect(AuditEvent.countDocuments({ deduplicationKey: payload.deduplicationKey })).resolves.toBe(1);
  });
});
