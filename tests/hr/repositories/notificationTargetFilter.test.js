const leave = require('../../../src/modules/hr/repositories/leave.repository');
const overtime = require('../../../src/modules/hr/repositories/overtime.repository');
const payroll = require('../../../src/modules/hr/repositories/payroll.repository');
const LeaveRequest = require('../../../src/modules/hr/models/leaveRequest.model');
const OvertimeRequest = require('../../../src/modules/hr/models/overtimeRequest.model');
const PayrollResult = require('../../../src/modules/hr/models/payrollResult.model');
const id = '660000000000000000000001';
const owner = '660000000000000000000002';
const query = () => ({ sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });
afterEach(() => jest.restoreAllMocks());
test.each([
  ['leave', leave, LeaveRequest], ['overtime', overtime, OvertimeRequest],
])('%s exact-id filter retains the ownership filter', async (_name, repo, model) => {
  jest.spyOn(model, 'find').mockReturnValue(query());
  jest.spyOn(model, 'countDocuments').mockResolvedValue(0);
  const scopeFilters = [{ 'requesterSnapshot.teamId': owner }];
  await repo.listRequests({ requestId: id, profileId: owner, scopeFilters });
  expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ _id: id, profileId: owner, $or: scopeFilters }));
});

test('announcement validator rejects malformed target IDs', () => {
  const validator = require('../../../src/modules/hr/validators/workspace.validator');
  const query = { dateKey: '2026-10-14', year: 2026, month: 10 };
  expect(validator.validate(validator.workspaceQuerySchema, { ...query, announcementId: id }).value.announcementId).toBe(id);
  expect(validator.validate(validator.workspaceQuerySchema, { ...query, announcementId: 'invalid' }).details).toBeDefined();
});
test('exact payslip lookup still restricts account and published statuses', async () => {
  jest.spyOn(PayrollResult, 'find').mockReturnValue(query());
  jest.spyOn(PayrollResult, 'countDocuments').mockResolvedValue(0);
  await payroll.listResultsForAccount(owner, { resultId: id });
  expect(PayrollResult.find).toHaveBeenCalledWith({ _id: id, accountId: owner, status: { $in: ['FINALIZED', 'PAID'] } });
});
test.each(['leave', 'overtime'])('%s validator retains and validates the notification target ID', (kind) => {
  const validator = require(`../../../src/modules/hr/validators/${kind}.validator`);
  expect(validator.validate(validator.listMyRequestsSchema, { requestId: id }).value.requestId).toBe(id);
  expect(validator.validate(validator.listMyRequestsSchema, { requestId: 'invalid' }).details).toBeDefined();
});
test('personal payroll validator validates the notification target ID', () => {
  const validator = require('../../../src/modules/hr/validators/payroll.validator');
  expect(validator.validate(validator.listMyPayrollSchema, { resultId: id }).value.resultId).toBe(id);
  expect(validator.validate(validator.listMyPayrollSchema, { resultId: 'invalid' }).details).toBeDefined();
});
