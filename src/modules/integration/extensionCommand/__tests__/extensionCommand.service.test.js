jest.mock('../../../auth/public', () => ({ canAccessScope: jest.fn(), getExtensionTokenMetadataByIds: jest.fn() }));
jest.mock('../repositories/extensionCommand.repository');
jest.mock('../../../../shared/utils/logger', () => ({ info: jest.fn() }));

const authPublic = require('../../../auth/public');
const repository = require('../repositories/extensionCommand.repository');
const logger = require('../../../../shared/utils/logger');
const service = require('../services/extensionCommand.service');

describe('extension command management', () => {
  test('lists offline agents with redacted token metadata', async () => {
    repository.listAgents.mockResolvedValue([{ _id: '507f1f77bcf86cd799439012', extensionTokenId: '507f1f77bcf86cd799439013', shopId: '507f1f77bcf86cd799439011', clientId: 'rdc-1', label: 'RDC 01', lastSeenAt: new Date(Date.now() - 91_000) }]);
    authPublic.canAccessScope.mockReturnValue(true);
    authPublic.getExtensionTokenMetadataByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439013', name: 'RDC 01 token', tokenHint: 'ab12' }]);

    await expect(service.listManagementAgents({})).resolves.toEqual({ items: [expect.objectContaining({ status: 'OFFLINE', token: expect.objectContaining({ tokenHint: 'ab12' }) })] });
  });

  test('logs a single reconnection after an agent was offline', async () => {
    const lastSeenAt = new Date(Date.now() - 91_000);
    repository.findAgentForToken.mockResolvedValue({ _id: 'agent-1', lastSeenAt });
    repository.upsertAgent.mockResolvedValue({ _id: 'agent-1' });

    await service.heartbeat(
      { clientId: 'rdc-1', label: 'RDC 01', version: '0.3.0' },
      { tokenType: 'EXTENSION', extensionTokenId: 'token-1', scopes: [{ scopeType: 'shop', scopeId: 'shop-1' }] },
    );

    expect(repository.upsertAgent).toHaveBeenCalledWith(expect.objectContaining({ lastReconnectedAt: expect.any(Date) }));
    expect(logger.info).toHaveBeenCalledWith('extension_agent_reconnected', expect.objectContaining({ agentId: 'agent-1', clientId: 'rdc-1', shopId: 'shop-1' }));
  });

  test('queues a manual import with the agent-scoped active key', async () => {
    repository.findAgentForToken.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1' });
    repository.createCommand.mockResolvedValue({ _id: 'command-1' });

    await expect(service.queueCurrentOrderImport(
      { clientId: 'rdc-1', label: 'RDC 01', numDays: 1 },
      { tokenType: 'EXTENSION', extensionTokenId: 'token-1' },
    )).resolves.toEqual({ _id: 'command-1' });

    expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_NEW_ORDERS', shopId: 'shop-1', agentId: 'agent-1', numDays: 1, activeOrderKey: 'agent-1',
    }));
  });

  test('rejects a duplicate active import before Amazon can be called', async () => {
    repository.findAgentForToken.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1' });
    repository.createCommand.mockRejectedValue({ code: 11000 });

    await expect(service.queueCurrentOrderImport(
      { clientId: 'rdc-1', label: 'RDC 01', numDays: 1 },
      { tokenType: 'EXTENSION', extensionTokenId: 'token-1' },
    )).rejects.toMatchObject({ statusCode: 409 });
  });

  test('queues a dated Ads import with the same agent lock', async () => {
    repository.findAgentForToken.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1' });
    repository.createCommand.mockResolvedValue({ _id: 'command-ads' });

    await expect(service.queueCurrentAdsImport(
      { clientId: 'rdc-1', label: 'RDC 01', dateFrom: '2026-08-23', dateTo: '2026-08-23' },
      { tokenType: 'EXTENSION', extensionTokenId: 'token-1' },
    )).resolves.toEqual({ _id: 'command-ads' });

    expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_ADS_SPEND', shopId: 'shop-1', agentId: 'agent-1', dateFrom: '2026-08-23', dateTo: '2026-08-23', activeOrderKey: 'agent-1',
    }));
  });
});
