jest.mock('../models/extensionCommand.model', () => ({ updateMany: jest.fn(), findOneAndUpdate: jest.fn() }));

const ExtensionCommand = require('../models/extensionCommand.model');
const repository = require('../repositories/extensionCommand.repository');
const { extensionCommandStatuses } = require('../constants/extensionCommand.constants');

describe('extension command leases', () => {
  beforeEach(() => jest.clearAllMocks());
  test('filters Etsy WEB Orders before atomic claim', async () => {
    const lean = jest.fn().mockResolvedValue(null);
    ExtensionCommand.findOneAndUpdate.mockReturnValue({ select: () => ({ lean }) });
    await repository.claimNext({ agentId: 'etsy', provider: 'ETSY', now: new Date(), leaseExpiresAt: new Date(), leaseTokenHash: 'hash' });
    expect(ExtensionCommand.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ provider: 'ETSY', type: 'IMPORT_NEW_ORDERS', origin: 'WEB', maxOrders: { $gte: 1, $lte: 200, $mod: [1, 0] } });
  });
  test('fails expired Etsy claims without requeueing or dropping job evidence', async () => {
    await repository.releaseExpired('etsy', new Date(), 'ETSY');
    expect(ExtensionCommand.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = ExtensionCommand.updateMany.mock.calls[0];
    expect(filter.status).toEqual({ $in: ['CLAIMED', 'RUNNING'] });
    expect(update.$set.status).toBe('FAILED');
    expect(update.$unset).toEqual({ activeOrderKey: 1 });
    expect(update.$set).not.toHaveProperty('importJobId');
  });
  test('renewal and completion queries require exact live ownership', async () => {
    ExtensionCommand.findOneAndUpdate.mockReturnValue({ lean: async () => null });
    await repository.updateClaimed({ commandId: 'command', agentId: 'agent', leaseTokenHash: 'hash', statuses: ['CLAIMED', 'RUNNING'], patch: { leaseExpiresAt: new Date() } });
    expect(ExtensionCommand.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ _id: 'command', agentId: 'agent', leaseTokenHash: 'hash', status: { $in: ['CLAIMED', 'RUNNING'] }, leaseExpiresAt: { $gt: expect.any(Date) } });
  });
  test('requeues expired claims but fails expired running commands', async () => {
    const now = new Date('2026-09-15T00:00:00.000Z');
    ExtensionCommand.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await repository.releaseExpired('agent-1', now);

    expect(ExtensionCommand.updateMany).toHaveBeenCalledTimes(2);
    expect(ExtensionCommand.updateMany).toHaveBeenNthCalledWith(1,
      { agentId: 'agent-1', status: extensionCommandStatuses.CLAIMED, leaseExpiresAt: { $lte: now } },
      { $set: { status: extensionCommandStatuses.QUEUED, claimedAt: null, startedAt: null, leaseExpiresAt: null, leaseTokenHash: null } },
    );
    expect(ExtensionCommand.updateMany).toHaveBeenNthCalledWith(2,
      { agentId: 'agent-1', status: extensionCommandStatuses.RUNNING, leaseExpiresAt: { $lte: now } },
      {
        $set: { status: extensionCommandStatuses.FAILED, completedAt: now, leaseExpiresAt: null, leaseTokenHash: null, errorMessage: 'Extension lease expired' },
        $unset: { activeOrderKey: 1 },
      },
    );
  });
});
