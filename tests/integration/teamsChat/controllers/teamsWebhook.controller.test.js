jest.mock('../../../../src/modules/integration/teamsChat/services/teamsSync.service', () => ({
  processInboundWebhookNotification: jest.fn(),
}));

const teamsSyncService = require('../../../../src/modules/integration/teamsChat/services/teamsSync.service');
const teamsWebhookController = require('../../../../src/modules/integration/teamsChat/controllers/teamsWebhook.controller');

describe('Teams webhook controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('responds to validationToken handshake with 200 and plain text token', async () => {
    const req = {
      query: { validationToken: 'validation-token-abc-123' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      contentType: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    await teamsWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.contentType).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('validation-token-abc-123');
    expect(teamsSyncService.processInboundWebhookNotification).not.toHaveBeenCalled();
  });

  test('responds to change notifications with 202 Accepted and processes asynchronously', async () => {
    teamsSyncService.processInboundWebhookNotification.mockResolvedValue({ status: 'PROCESSED' });

    const req = {
      query: {},
      body: {
        value: [
          { subscriptionId: 'sub-1', resource: "chats('19:chat@unq.gbl.spaces')/messages('101')" },
          { subscriptionId: 'sub-1', resource: "chats('19:chat@unq.gbl.spaces')/messages('102')" },
        ],
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await teamsWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ received: 2 });
    expect(teamsSyncService.processInboundWebhookNotification).toHaveBeenCalledTimes(2);
  });

  test('handles empty notification value payload gracefully', async () => {
    const req = {
      query: {},
      body: { value: [] },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await teamsWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ received: 0 });
    expect(teamsSyncService.processInboundWebhookNotification).not.toHaveBeenCalled();
  });
});
