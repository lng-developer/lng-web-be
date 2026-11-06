jest.mock('../../../src/modules/integration/sqlAttendance/public', () => ({
  enqueueSync: jest.fn(),
  getStatus: jest.fn(),
  syncPage: jest.fn(),
}));

const sqlAttendance = require('../../../src/modules/integration/sqlAttendance/public');
const controller = require('../../../src/modules/integration/sqlAttendance/controllers/sqlAttendance.controller');

function response() {
  return {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => jest.clearAllMocks());

test('sync keeps 202 and returns the standard success envelope when queued', async () => {
  sqlAttendance.enqueueSync.mockResolvedValue({ queued: true });
  const req = { body: { limit: 250 } };
  const res = response();

  await controller.sync(req, res);

  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { queued: true } });
});

test('sync returns 200 and immediate results when immediate is true', async () => {
  sqlAttendance.syncPage.mockResolvedValue({ fetched: 10, inserted: 10, updated: 0, unchanged: 0, failed: 0 });
  const req = { body: { limit: 100, immediate: true } };
  const res = response();

  await controller.sync(req, res);

  expect(sqlAttendance.syncPage).toHaveBeenCalledWith({ limit: 100 });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: { fetched: 10, inserted: 10, updated: 0, unchanged: 0, failed: 0 },
  });
});

test('status keeps 200 and returns the standard success envelope', async () => {
  sqlAttendance.getStatus.mockResolvedValue({ status: 'IDLE' });
  const res = response();

  await controller.status({}, res);

  expect(res.json).toHaveBeenCalledWith({ success: true, data: { status: 'IDLE' } });
});
