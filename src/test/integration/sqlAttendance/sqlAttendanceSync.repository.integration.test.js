const { assertTestDatabaseName, startIsolatedMongo } = require('../../helpers/isolatedMongo');
const AttendanceImportBatch = require('../../../modules/hr/models/attendanceImportBatch.model');
const batchRepository = require('../../../modules/hr/repositories/attendanceImportBatch.repository');
const SyncState = require('../../../modules/integration/sqlAttendance/models/sqlAttendanceSync.model');
const repository = require('../../../modules/integration/sqlAttendance/repositories/sqlAttendanceSync.repository');

const key = 'codex-task-4-test';
let database;

jest.setTimeout(120000);

describe('SQL attendance cursor persistence', () => {
  beforeAll(async () => {
    database = await startIsolatedMongo('lng_web_be_task4_test');
    await SyncState.init();
    await AttendanceImportBatch.init();
  });

  afterAll(async () => {
    await database.stop();
  });

  test('persists compound watermark state and enforces one record per source batch', async () => {
    await repository.getState(key);
    await repository.advance({
      key,
      lastSourceTimestamp: new Date('2026-07-18T01:00:00.000Z'),
      lastSourceEventId: '10',
      sourceBatchId: 'batch-10',
      result: { inserted: 1, updated: 0, unchanged: 0, failed: 0 },
    });
    await repository.markFailed({ key, errorMessage: 'later page failed' });

    await expect(repository.getState(key)).resolves.toMatchObject({
      status: 'FAILED',
      lastSourceTimestamp: new Date('2026-07-18T01:00:00.000Z'),
      lastSourceEventId: '10',
      lastSourceBatchId: 'batch-10',
    });

    await expect(batchRepository.claim('batch-unique', 2)).resolves.toMatchObject({ acquired: true });
    await expect(batchRepository.claim('batch-unique', 2)).resolves.toMatchObject({ acquired: false });
    await expect(AttendanceImportBatch.countDocuments({ sourceBatchId: 'batch-unique' })).resolves.toBe(1);
  });

  test('refuses a non-test database name before starting Mongo', () => {
    expect(() => assertTestDatabaseName('lng_web_be')).toThrow('Refusing non-test Mongo database');
  });
});
