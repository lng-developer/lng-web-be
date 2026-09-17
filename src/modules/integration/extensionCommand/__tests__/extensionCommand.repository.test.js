jest.mock('../models/extensionCommand.model', () => ({ updateMany: jest.fn(), findOneAndUpdate: jest.fn(), find: jest.fn(), countDocuments: jest.fn() }));

const ExtensionCommand = require('../models/extensionCommand.model');
const repository = require('../repositories/extensionCommand.repository');
const { extensionCommandStatuses } = require('../constants/extensionCommand.constants');

describe('extension command leases', () => {
  test('agent history applies both agent and shop restrictions at the database boundary', async () => {
    const query = { sort: () => query, skip: () => query, limit: () => query, lean: async () => [] };
    ExtensionCommand.find.mockReturnValue(query);
    ExtensionCommand.countDocuments.mockResolvedValue(0);
    await repository.listCommands({ shopIds: ['shop-1'], agentId: 'agent-1', page: 1, limit: 100 });
    expect(ExtensionCommand.find).toHaveBeenCalledWith({ shopId: { $in: ['shop-1'] }, agentId: 'agent-1' });
    expect(ExtensionCommand.countDocuments).toHaveBeenCalledWith({ shopId: { $in: ['shop-1'] }, agentId: 'agent-1' });
  });
  test('lease updates atomically require the owner, token, running state, and unexpired lease', async () => {
    ExtensionCommand.findOneAndUpdate.mockReturnValue({ lean: async () => null });
    await repository.updateClaimed({ commandId: 'cmd', agentId: 'agent', leaseTokenHash: 'hash', statuses: ['RUNNING'], patch: { leaseExpiresAt: new Date() } });
    expect(ExtensionCommand.findOneAndUpdate).toHaveBeenCalledWith({
      _id: 'cmd', agentId: 'agent', leaseTokenHash: 'hash', status: { $in: ['RUNNING'] }, leaseExpiresAt: { $gt: expect.any(Date) },
    }, expect.any(Object), expect.objectContaining({ runValidators: true }));
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
