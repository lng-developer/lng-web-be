jest.mock('../../../auth/public', () => ({ canAccessScope: jest.fn(), getExtensionTokenMetadataByIds: jest.fn() }));
jest.mock('../repositories/extensionCommand.repository');

const authPublic = require('../../../auth/public');
const repository = require('../repositories/extensionCommand.repository');
const service = require('../services/extensionCommand.service');

describe('extension command management', () => {
  test('lists offline agents with redacted token metadata', async () => {
    repository.listAgents.mockResolvedValue([{ _id: '507f1f77bcf86cd799439012', extensionTokenId: '507f1f77bcf86cd799439013', shopId: '507f1f77bcf86cd799439011', clientId: 'rdc-1', label: 'RDC 01', lastSeenAt: new Date(Date.now() - 91_000) }]);
    authPublic.canAccessScope.mockReturnValue(true);
    authPublic.getExtensionTokenMetadataByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439013', name: 'RDC 01 token', tokenHint: 'ab12' }]);

    await expect(service.listManagementAgents({})).resolves.toEqual({ items: [expect.objectContaining({ status: 'OFFLINE', token: expect.objectContaining({ tokenHint: 'ab12' }) })] });
  });
});
