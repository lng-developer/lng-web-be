jest.mock('../../../auth/public', () => ({ canAccessScope: jest.fn(() => true) }));
jest.mock('../repositories/extensionCommand.repository');
jest.mock('../../../../shared/utils/logger', () => ({ info: jest.fn() }));
jest.mock('../../externalOrderImport/public', () => ({ getImportJob: jest.fn() }));

const repository = require('../repositories/extensionCommand.repository');
const service = require('../services/extensionCommand.service');
const validator = require('../validators/extensionCommand.validator');
const { toAgentDto, toCommandDto } = require('../dtos/extensionCommand.dto');
const imports = require('../../externalOrderImport/public');
const agent = { _id: 'agent-1', shopId: 'shop-1', provider: 'ETSY', protocolVersion: 1 };
const input = { agentId: agent._id, shopId: agent.shopId, type: 'IMPORT_NEW_ORDERS' };
const auth = { tokenType: 'EXTENSION', extensionTokenId: 'token-1', scopes: [{ scopeType: 'shop', scopeId: 'shop-1' }] };

beforeEach(() => {
  jest.clearAllMocks();
  repository.findAgentById.mockResolvedValue(agent);
  repository.findAgentForToken.mockResolvedValue(agent);
  repository.createCommand.mockImplementation(async payload => payload);
  repository.upsertAgent.mockImplementation(async payload => payload);
});

test('acknowledges supported Etsy protocol in heartbeat DTO', async () => {
  const value = validator.validate(validator.heartbeatSchema, { clientId: 'vm', label: 'VM', provider: 'ETSY', protocolVersion: 1 }).value;
  expect(toAgentDto(await service.heartbeat(value, auth))).toMatchObject({ provider: 'ETSY', protocolVersion: 1 });
});
test.each([undefined, 1, 200])('creates WEB Etsy command with count %s', async maxOrders => {
  await expect(service.createCommand({ ...input, maxOrders }, {})).resolves.toMatchObject({ origin: 'WEB', provider: 'ETSY', maxOrders: maxOrders ?? 1 });
});
test.each([0, 201, 1.5])('rejects invalid Etsy count %s', async maxOrders => {
  await expect(service.createCommand({ ...input, maxOrders }, {})).rejects.toMatchObject({ statusCode: 400 });
});
test('rejects other shop', async () => {
  await expect(service.createCommand({ ...input, shopId: 'other' }, {})).rejects.toMatchObject({ statusCode: 404 });
});
test('preserves legacy day window', async () => {
  repository.findAgentById.mockResolvedValue({ _id: agent._id, shopId: agent.shopId });
  await expect(service.createCommand({ ...input, numDays: 7 }, {})).resolves.toMatchObject({ numDays: 7 });
});
test.each(['IMPORT_ADS_SPEND', 'TEST_CONNECTION'])('rejects Etsy %s', async type => {
  await expect(service.createCommand({ ...input, type }, {})).rejects.toMatchObject({ statusCode: 400 });
});
test('does not allow extension-origin Etsy queueing', async () => {
  await expect(service.queueCurrentOrderImport({ clientId: 'vm' }, auth)).rejects.toMatchObject({ statusCode: 400 });
});
test('filters Etsy claims in repository before leasing', async () => {
  await service.claimNext({ clientId: 'vm' }, auth);
  expect(repository.claimNext).toHaveBeenCalledWith(expect.objectContaining({ provider: 'ETSY' }));
});
test('does not enable Etsy schedules', async () => {
  await expect(service.upsertOrderSchedule(agent._id, { enabled: true, intervalMinutes: 60 }, {})).rejects.toMatchObject({ statusCode: 400 });
  await expect(service.upsertFinanceSchedule(agent._id, 'TRANSACTIONS', { enabled: true }, {})).rejects.toMatchObject({ statusCode: 400 });
});
test('dispatchers leave existing Etsy schedules untouched', async () => {
  repository.listDueOrderSchedules.mockResolvedValue([{ _id: 'order-schedule', agentId: agent._id }]);
  repository.listDueFinanceSchedules.mockResolvedValue([{ _id: 'finance-schedule', agentId: agent._id }]);
  await service.dispatchDueOrderSchedules();
  await service.dispatchDueFinanceSchedules();
  expect(repository.claimDueOrderSchedule).not.toHaveBeenCalled();
  expect(repository.claimDueFinanceSchedule).not.toHaveBeenCalled();
  expect(repository.createCommand).not.toHaveBeenCalled();
});
test('renews only active ownership without resetting status', async () => {
  repository.updateClaimed.mockResolvedValue({ _id: 'task', status: 'RUNNING' });
  await expect(service.renewCommand('task', { clientId: 'vm', leaseToken: 'secret' }, auth)).resolves.toMatchObject({ status: 'RUNNING' });
  const query = repository.updateClaimed.mock.calls[0][0];
  expect(query).toMatchObject({ agentId: agent._id, statuses: ['CLAIMED', 'RUNNING'], patch: { leaseExpiresAt: expect.any(Date) } });
  expect(query.patch).not.toHaveProperty('status');
});
test('rejects lost or expired ownership', async () => {
  repository.updateClaimed.mockResolvedValue(null);
  await expect(service.renewCommand('task', { clientId: 'vm', leaseToken: 'wrong' }, auth)).rejects.toMatchObject({ statusCode: 409 });
});
test.each([{ shopId: 'other', salesChannelCode: 'ETSY', idempotencyKey: 'task' }, { shopId: 'shop-1', salesChannelCode: 'AMAZON', idempotencyKey: 'task' }, { shopId: 'shop-1', salesChannelCode: 'ETSY', idempotencyKey: 'other' }])('rejects unrelated job %j', async job => {
  imports.getImportJob.mockResolvedValue(job);
  await expect(service.renewCommand('task', { clientId: 'vm', leaseToken: 'secret', importJobId: 'job' }, auth)).rejects.toMatchObject({ statusCode: 400 });
  expect(repository.updateClaimed).not.toHaveBeenCalled();
});
test('associates authorized job with task before completion', async () => {
  imports.getImportJob.mockResolvedValue({ shopId: 'shop-1', salesChannelCode: 'ETSY', idempotencyKey: 'task' });
  repository.updateClaimed.mockResolvedValue({ _id: 'task', importJobId: 'job' });
  await expect(service.renewCommand('task', { clientId: 'vm', leaseToken: 'secret', importJobId: 'job' }, auth)).resolves.toMatchObject({ importJobId: 'job' });
  expect(imports.getImportJob).toHaveBeenCalledWith('job', auth);
});
test('shows expired Etsy task as failed and retains request count and job', () => {
  expect(toCommandDto({ _id: 'task', provider: 'ETSY', origin: 'WEB', maxOrders: 5, status: 'RUNNING', leaseExpiresAt: new Date(0), importJobId: 'job' })).toMatchObject({ provider: 'ETSY', origin: 'WEB', maxOrders: 5, status: 'FAILED', importJobId: 'job', errorMessage: 'Extension lease expired' });
});
test('retries a lost completion response without changing a terminal Etsy task', async () => {
  repository.updateClaimed.mockResolvedValue(null);
  repository.findCompletedForLease = jest.fn().mockResolvedValue({ _id: 'task', status: 'SUCCEEDED' });
  await expect(service.completeCommand('task', { clientId: 'vm', leaseToken: 'secret', success: true }, auth)).resolves.toMatchObject({ status: 'SUCCEEDED' });
});
