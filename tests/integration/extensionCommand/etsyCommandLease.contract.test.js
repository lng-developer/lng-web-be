jest.mock('../../../src/modules/integration/extensionCommand/services/extensionCommand.service', () => ({ renewCommand: jest.fn() }));
const service = require('../../../src/modules/integration/extensionCommand/services/extensionCommand.service');
const controller = require('../../../src/modules/integration/extensionCommand/controllers/extensionCommand.controller');
const commandId = '507f1f77bcf86cd799439012';
const importJobId = '507f1f77bcf86cd799439013';
const auth = { tokenType: 'EXTENSION', extensionTokenId: 'token' };
const body = { clientId: 'vm', label: 'VM', provider: 'ETSY', protocolVersion: 1, leaseToken: 'x'.repeat(24), importJobId };
test('renew validates agent and lease, exposes count/job but never lease hash', async () => {
  service.renewCommand.mockResolvedValue({ _id: commandId, provider: 'ETSY', origin: 'WEB', maxOrders: 1, status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 300000), importJobId, leaseTokenHash: 'private' });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.renewCommand({ params: { commandId }, body, auth }, res);
  expect(service.renewCommand).toHaveBeenCalledWith(commandId, { ...body, listingImageSync: false }, auth);
  expect(res.json.mock.calls[0][0].data).toMatchObject({ maxOrders: 1, origin: 'WEB', provider: 'ETSY', importJobId });
  expect(res.json.mock.calls[0][0].data).not.toHaveProperty('leaseTokenHash');
});
test.each([{ leaseToken: 'short' }, { importJobId: 'invalid' }, { protocolVersion: 2 }])('rejects malformed renew %j', async invalid => {
  await expect(controller.renewCommand({ params: { commandId }, body: { ...body, ...invalid }, auth }, {})).rejects.toMatchObject({ statusCode: 400 });
});
