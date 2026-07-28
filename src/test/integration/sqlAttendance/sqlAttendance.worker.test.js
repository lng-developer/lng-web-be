const { processSqlAttendanceJob } = require('../../../modules/integration/sqlAttendance/workers/sqlAttendance.worker');

test('worker returns the completed page result without starting on module import', async () => {
  const result = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };

  await expect(processSqlAttendanceJob({ data: { limit: 50 } }, {
    syncPage: async ({ limit }) => ({ ...result, limit }),
  })).resolves.toEqual({ ...result, limit: 50 });
});
