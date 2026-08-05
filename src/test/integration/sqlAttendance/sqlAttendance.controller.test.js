jest.mock('../../../modules/integration/sqlAttendance/public', () => ({
  enqueueSync: jest.fn(),
  getStatus: jest.fn(),
}));

const sqlAttendance = require('../../../modules/integration/sqlAttendance/public');
const controller = require('../../../modules/integration/sqlAttendance/controllers/sqlAttendance.controller');

function response() {
  return {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => jest.clearAllMocks());

test('sync keeps 202 and returns the standard success envelope', async () => {
  sqlAttendance.enqueueSync.mockResolvedValue({ queued: true });
  const req = { body: { limit: 250 } };
  const res = response();

  await controller.sync(req, res);

  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { queued: true } });
});

test('status keeps 200 and returns the standard success envelope', async () => {
  sqlAttendance.getStatus.mockResolvedValue({ status: 'IDLE' });
  const res = response();

  await controller.status({}, res);

  expect(res.json).toHaveBeenCalledWith({ success: true, data: { status: 'IDLE' } });
});
