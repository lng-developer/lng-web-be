jest.mock('../repositories/extensionCommand.repository');
jest.mock('../../../auth/public', () => ({ canAccessScope: jest.fn() }));

const repository = require('../repositories/extensionCommand.repository');
const authPublic = require('../../../auth/public');
const service = require('../services/extensionCommand.service');

describe('extension order schedules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('queues the first enabled schedule immediately', async () => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1', lastSeenAt: now });
    repository.findOrderScheduleByAgentId = jest.fn().mockResolvedValue(null);
    repository.upsertOrderSchedule.mockResolvedValue({ _id: 'schedule-1' });
    repository.listDueOrderSchedules.mockResolvedValue([{
      _id: 'schedule-1', shopId: 'shop-1', agentId: { _id: 'agent-1', lastSeenAt: now }, intervalMinutes: 60,
    }]);
    repository.claimDueOrderSchedule.mockResolvedValue(true);
    repository.hasActiveOrderCommand.mockResolvedValue(false);

    await service.upsertOrderSchedule('agent-1', { enabled: true, intervalMinutes: 60 }, { accountId: 'account-1' });

    expect(repository.upsertOrderSchedule).toHaveBeenCalledWith(expect.objectContaining({ runImmediately: true }));
    expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_NEW_ORDERS', shopId: 'shop-1', agentId: 'agent-1', numDays: 1,
    }));
  });

  test('queues a due schedule when the agent heartbeat refreshed after the due query', async () => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    repository.listDueOrderSchedules.mockResolvedValue([{
      _id: 'schedule-1',
      shopId: 'shop-1',
      agentId: { _id: 'agent-1', lastSeenAt: new Date(now.getTime() - 5 * 60_000) },
      intervalMinutes: 120,
    }]);
    repository.claimDueOrderSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', lastSeenAt: new Date(now.getTime() - 60_000) });
    repository.hasActiveOrderCommand.mockResolvedValue(false);

    await service.dispatchDueOrderSchedules(now);

    expect(repository.createCommand).toHaveBeenCalledWith({
      type: 'IMPORT_NEW_ORDERS',
      shopId: 'shop-1',
      agentId: 'agent-1',
      numDays: 1,
      createdByAccountId: null,
      activeOrderKey: 'agent-1',
    });
    expect(repository.markOrderScheduleQueued).toHaveBeenCalledWith('schedule-1', now);
  });

  test.each([
    ['agent is offline', { _id: 'agent-1', lastSeenAt: new Date('2026-08-22T23:58:00.000Z') }, false, 'AGENT_OFFLINE'],
    ['an order task is active', { _id: 'agent-1', lastSeenAt: new Date('2026-08-22T23:59:00.000Z') }, true, 'ACTIVE_ORDER_COMMAND'],
  ])('postpones the schedule when %s', async (_label, agentId, hasActiveCommand, reason) => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    repository.listDueOrderSchedules.mockResolvedValue([{ _id: 'schedule-1', shopId: 'shop-1', agentId, intervalMinutes: 120 }]);
    repository.claimDueOrderSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue(agentId);
    repository.hasActiveOrderCommand.mockResolvedValue(hasActiveCommand);

    await service.dispatchDueOrderSchedules(now);

    expect(repository.createCommand).not.toHaveBeenCalled();
    expect(repository.postponeOrderSchedule).toHaveBeenCalledWith('schedule-1', now, reason);
  });
});
