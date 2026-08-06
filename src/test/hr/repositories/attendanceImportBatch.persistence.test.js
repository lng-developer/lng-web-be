const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AttendanceImportBatch = require('../../../modules/hr/models/attendanceImportBatch.model');
const repository = require('../../../modules/hr/repositories/attendanceImportBatch.repository');

describe('attendance import batch claim persistence', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await AttendanceImportBatch.init();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  afterEach(() => AttendanceImportBatch.deleteMany({}));

  test('gives exactly one owner two concurrent claims for the same source batch', async () => {
    const results = await Promise.all([
      repository.claim('sql:race', 2),
      repository.claim('sql:race', 2),
    ]);

    expect(results.filter(({ acquired }) => acquired)).toHaveLength(1);
    expect(results.filter(({ acquired }) => !acquired)).toHaveLength(1);
    await expect(AttendanceImportBatch.countDocuments({
      sourceBatchId: 'sql:race', status: 'PROCESSING',
    })).resolves.toBe(1);
  });
});
