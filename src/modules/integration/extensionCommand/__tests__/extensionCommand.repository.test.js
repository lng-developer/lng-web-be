jest.mock('../models/extensionCommand.model', () => ({ updateMany: jest.fn() }));

const ExtensionCommand = require('../models/extensionCommand.model');
const repository = require('../repositories/extensionCommand.repository');
const { extensionCommandStatuses } = require('../constants/extensionCommand.constants');

describe('extension command leases', () => {
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
