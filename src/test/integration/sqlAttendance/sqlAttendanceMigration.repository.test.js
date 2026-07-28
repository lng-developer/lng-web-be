const sqlAttendancePublic = require('../../../modules/integration/sqlAttendance/public');

function inMemoryModel() {
  let state = null;
  return {
    findOne: () => ({ lean: async () => state && { ...state } }),
    findOneAndUpdate: (_filter, update) => ({ lean: async () => {
      state = { ...(state || {}), ...(update.$set || {}) };
      return { ...state };
    } }),
  };
}

test('legacy SQL watermark replay is unchanged after normalized persistence', async () => {
  const model = inMemoryModel();
  const state = {
    key: 'default', status: 'SUCCESS', lastSourceTimestamp: new Date('2026-07-27T00:00:00.000Z'),
    lastSourceEventId: 'legacy-1', lastSourceBatchId: 'legacy:1',
    lastResult: { fetched: 2, inserted: 1, updated: 0, unchanged: 1, failed: 0 },
    errorMessage: null, lastStartedAt: new Date('2026-07-27T00:00:00.000Z'), lastFinishedAt: new Date('2026-07-27T00:00:00.000Z'),
  };

  await expect(sqlAttendancePublic.migrateLegacyState(state, { apply: true, model })).resolves.toEqual({ inserted: 1, updated: 0, unchanged: 0, failed: 0 });
  await expect(sqlAttendancePublic.migrateLegacyState({ ...state, lastSourceTimestamp: '2026-07-27T00:00:00.000Z' }, { apply: true, model }))
    .resolves.toEqual({ inserted: 0, updated: 0, unchanged: 1, failed: 0 });
});
