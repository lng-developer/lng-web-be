const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const SyncState = require('../../../modules/integration/sqlAttendance/models/sqlAttendanceSync.model');
const repository = require('../../../modules/integration/sqlAttendance/repositories/sqlAttendanceSync.repository');

const describeIfDb = process.env.RUN_DB_SQL_ATTENDANCE_TESTS === 'true' ? describe : describe.skip;
const key = 'codex-task-4-test';

describeIfDb('SQL attendance cursor persistence', () => {
  beforeAll(async () => {
    await connectDatabase();
    await SyncState.init();
    await SyncState.deleteMany({ key });
  });

  afterAll(async () => {
    await SyncState.deleteMany({ key });
    await disconnectDatabase();
  });

  test('persists the compound cursor and a failure cannot move it', async () => {
    await repository.getState(key);
    await repository.advance({
      key,
      lastSourceTimestamp: new Date('2026-07-18T01:00:00.000Z'),
      lastSourceId: '10',
      sourceBatchId: 'batch-10',
      result: { inserted: 1, updated: 0, unchanged: 0, failed: 0 },
    });
    await repository.markFailed({ key, errorMessage: 'later page failed' });

    await expect(repository.getState(key)).resolves.toMatchObject({
      status: 'FAILED',
      lastSourceTimestamp: new Date('2026-07-18T01:00:00.000Z'),
      lastSourceId: '10',
      lastSourceBatchId: 'batch-10',
    });
  });
});
