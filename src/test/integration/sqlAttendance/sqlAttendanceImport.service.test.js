const { syncPage } = require('../../../modules/integration/sqlAttendance/services/sqlAttendanceImport.service');

function stateRepository(initial = {}) {
  const state = {
    lastSourceTimestamp: null,
    lastSourceId: null,
    status: 'IDLE',
    ...initial,
  };
  return {
    state,
    getState: async () => ({ ...state }),
    markRunning: async () => { state.status = 'RUNNING'; },
    markFailed: async ({ errorMessage }) => { state.status = 'FAILED'; state.errorMessage = errorMessage; },
    advance: async ({ lastSourceTimestamp, lastSourceId, result }) => {
      state.status = 'SUCCESS';
      state.lastSourceTimestamp = lastSourceTimestamp;
      state.lastSourceId = lastSourceId;
      state.lastResult = result;
    },
  };
}

const page = [
  { sourceId: '10', employeeCode: 'J2501', occurredAt: new Date('2026-07-18T01:00:00.000Z') },
  { sourceId: '11', employeeCode: 'J2501', occurredAt: new Date('2026-07-18T10:30:00.000Z') },
];

test('does not advance either cursor field when HR reports a failed punch', async () => {
  const repository = stateRepository({
    lastSourceTimestamp: new Date('2026-07-17T10:00:00.000Z'),
    lastSourceId: '9',
  });

  await expect(syncPage({ limit: 100 }, {
    client: { fetchPage: async () => page },
    repository,
    hrPort: { importAttendancePunches: async () => ({ inserted: 1, updated: 0, unchanged: 0, failed: 1 }) },
  })).rejects.toMatchObject({ code: 'SQL_ATTENDANCE_PAGE_FAILED' });

  expect(repository.state.lastSourceTimestamp).toEqual(new Date('2026-07-17T10:00:00.000Z'));
  expect(repository.state.lastSourceId).toBe('9');
  expect(repository.state.status).toBe('FAILED');
});

test('advances timestamp and tie-break id only after the whole page succeeds', async () => {
  const repository = stateRepository();

  await expect(syncPage({ limit: 100 }, {
    client: { fetchPage: async () => page },
    repository,
    hrPort: { importAttendancePunches: async () => ({ inserted: 2, updated: 0, unchanged: 0, failed: 0 }) },
  })).resolves.toEqual(expect.objectContaining({ inserted: 2, failed: 0, fetched: 2 }));

  expect(repository.state.lastSourceTimestamp).toEqual(new Date('2026-07-18T10:30:00.000Z'));
  expect(repository.state.lastSourceId).toBe('11');
});

test('passes the persisted tie-break id so equal timestamps continue on the next page', async () => {
  const timestamp = new Date('2026-07-18T01:00:00.000Z');
  const repository = stateRepository({ lastSourceTimestamp: timestamp, lastSourceId: '10' });
  const cursors = [];
  const client = {
    fetchPage: async (cursor) => {
      cursors.push(cursor);
      return [{ sourceId: '11', employeeCode: 'J2501', occurredAt: timestamp }];
    },
  };
  const hrPort = { importAttendancePunches: async () => ({ inserted: 1, updated: 0, unchanged: 0, failed: 0 }) };

  await syncPage({ limit: 1 }, { client, repository, hrPort });

  expect(cursors).toEqual([expect.objectContaining({
    afterTimestamp: timestamp,
    afterSourceId: '10',
    limit: 1,
  })]);
  expect(repository.state.lastSourceTimestamp).toEqual(timestamp);
  expect(repository.state.lastSourceId).toBe('11');
});
