jest.mock('../../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository', () => ({
  findByAccountId: jest.fn(),
  getWithRefreshToken: jest.fn(),
}));
jest.mock('../../../../src/modules/auth/public', () => ({ getCurrentAccount: jest.fn() }));

const teamsUserMappingRepository = require('../../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository');
const authPublic = require('../../../../src/modules/auth/public');
const teamsAdminController = require('../../../../src/modules/integration/teamsChat/controllers/teamsAdmin.controller');

describe('teamsAdminController.getOAuthStatus', () => {
  it('returns only the signed-in user OAuth state', async () => {
    teamsUserMappingRepository.findByAccountId.mockResolvedValue({ entraUserId: 'entra-user-1' });
    teamsUserMappingRepository.getWithRefreshToken.mockResolvedValue({ encryptedRefreshToken: 'encrypted' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await teamsAdminController.getOAuthStatus({ auth: { accountId: 'account-1' } }, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ userLinked: true, grantStatus: 'CONNECTED' }),
    });
    expect(res.json.mock.calls[0][0].data).not.toHaveProperty('tenantId');
    expect(res.json.mock.calls[0][0].data).not.toHaveProperty('webhookConfigured');
  });

  it('offers first-time setup to a Microsoft SSO account without a Teams mapping', async () => {
    teamsUserMappingRepository.findByAccountId.mockResolvedValue(null);
    authPublic.getCurrentAccount.mockResolvedValue({ account: { microsoftId: 'entra-user-1' } });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await teamsAdminController.getOAuthStatus({ auth: { accountId: 'account-1' } }, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { enabled: expect.any(Boolean), userLinked: true, grantStatus: 'NOT_CONNECTED' },
    });
  });
});

describe("teamsAdminController.ensureSubscription", () => {
  it("sanitizes clientState and raw MongoDB fields from the subscription payload", async () => {
    const teamsSyncService = require("../../../../src/modules/integration/teamsChat/services/teamsSync.service");
    jest.spyOn(teamsSyncService, "ensureWebhookSubscription").mockResolvedValue({
      status: "ACTIVE",
      subscription: {
        _id: "507f1f77bcf86cd799439011",
        subscriptionId: "sub-123",
        resource: "/chats/getAllMessages",
        clientState: "super-secret-client-state",
        notificationUrl: "https://example.com/webhook",
        status: "ACTIVE",
        __v: 0,
      },
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await teamsAdminController.ensureSubscription({}, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        status: "ACTIVE",
        subscription: {
          id: "sub-123",
          subscriptionId: "sub-123",
          resource: "/chats/getAllMessages",
          notificationUrl: "https://example.com/webhook",
          expirationDateTime: undefined,
          status: "ACTIVE",
          createdAt: undefined,
          updatedAt: undefined,
        },
      },
    });
    expect(res.json.mock.calls[0][0].data.subscription).not.toHaveProperty("clientState");
    expect(res.json.mock.calls[0][0].data.subscription).not.toHaveProperty("_id");
    expect(res.json.mock.calls[0][0].data.subscription).not.toHaveProperty("__v");
  });
});
