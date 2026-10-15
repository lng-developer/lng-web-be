jest.mock('../../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository', () => ({
  findByAccountId: jest.fn(),
  getWithRefreshToken: jest.fn(),
}));

const teamsUserMappingRepository = require('../../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository');
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
});
