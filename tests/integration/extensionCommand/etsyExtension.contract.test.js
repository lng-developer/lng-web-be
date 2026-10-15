jest.mock('../../../src/modules/integration/extensionCommand/services/extensionCommand.service', () => ({
  heartbeat: jest.fn(),
  claimNext: jest.fn(),
  startCommand: jest.fn(),
  completeCommand: jest.fn(),
}));

const service = require('../../../src/modules/integration/extensionCommand/services/extensionCommand.service');
const controller = require('../../../src/modules/integration/extensionCommand/controllers/extensionCommand.controller');

const commandId = '507f1f77bcf86cd799439012';
const agentRequest = { clientId: 'etsy-worker-1', label: 'Etsy worker', version: '1.1.0', apiBaseUrl: 'https://api.lngmerch.co' };
const auth = { tokenType: 'EXTENSION', extensionTokenId: '507f1f77bcf86cd799439011' };
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const command = { _id: commandId, type: 'IMPORT_NEW_ORDERS', shopId: '507f1f77bcf86cd799439013', agentId: '507f1f77bcf86cd799439014', numDays: 1 };

describe('Etsy extension command contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts the documented heartbeat, claim, start and complete lifecycle', async () => {
    service.heartbeat.mockResolvedValue({ _id: '507f1f77bcf86cd799439014', shopId: command.shopId, ...agentRequest });
    service.claimNext.mockResolvedValue({ command, leaseToken: 'x'.repeat(20) });
    service.startCommand.mockResolvedValue(command);
    service.completeCommand.mockResolvedValue(command);

    const heartbeat = response();
    await controller.heartbeat({ body: agentRequest, auth }, heartbeat);
    const claim = response();
    await controller.claimNext({ body: agentRequest, auth }, claim);
    const start = response();
    await controller.startCommand({ params: { commandId }, body: { ...agentRequest, leaseToken: 'x'.repeat(20) }, auth }, start);
    const complete = response();
    await controller.completeCommand({ params: { commandId }, body: { ...agentRequest, leaseToken: 'x'.repeat(20), success: true, importedCount: 1, failedCount: 0 }, auth }, complete);

    expect(claim.json.mock.calls[0][0].data).toEqual(expect.objectContaining({
      leaseToken: 'x'.repeat(20),
      command: expect.objectContaining({ id: commandId, type: 'IMPORT_NEW_ORDERS', numDays: 1 }),
    }));
    expect(service.startCommand).toHaveBeenCalledWith(commandId, expect.objectContaining({ leaseToken: 'x'.repeat(20) }), auth);
    expect(service.completeCommand).toHaveBeenCalledWith(commandId, expect.objectContaining({ success: true, importedCount: 1, failedCount: 0 }), auth);
  });
});
