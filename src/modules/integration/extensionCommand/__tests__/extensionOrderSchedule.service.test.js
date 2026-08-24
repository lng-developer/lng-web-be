jest.mock('../repositories/extensionCommand.repository');

const repository = require('../repositories/extensionCommand.repository');
const service = require('../services/extensionCommand.service');

describe('extension order schedules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('queues one one-day order command for a due online schedule', async () => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    repository.listDueOrderSchedules.mockResolvedValue([{
      _id: 'schedule-1',
      shopId: 'shop-1',
      agentId: { _id: 'agent-1', lastSeenAt: new Date(now.getTime() - 60_000) },
      intervalMinutes: 120,
    }]);
    repository.claimDueOrderSchedule.mockResolvedValue(true);
    repository.hasActiveOrderCommand.mockResolvedValue(false);

    await service.dispatchDueOrderSchedules(now);

    expect(repository.createCommand).toHaveBeenCalledWith({
      type: 'IMPORT_NEW_ORDERS',
      shopId: 'shop-1',
      agentId: 'agent-1',
      numDays: 1,
      createdByAccountId: null,
    });
    expect(repository.markOrderScheduleQueued).toHaveBeenCalledWith('schedule-1', now);
  });

  test.each([
    ['agent is offline', { _id: 'agent-1', lastSeenAt: new Date('2026-08-22T23:58:00.000Z') }, false],
    ['an order task is active', { _id: 'agent-1', lastSeenAt: new Date('2026-08-22T23:59:00.000Z') }, true],
  ])('postpones the schedule when %s', async (_label, agentId, hasActiveCommand) => {
    const now = new Date('2026-08-23T00:00:00.000Z');
    repository.listDueOrderSchedules.mockResolvedValue([{ _id: 'schedule-1', shopId: 'shop-1', agentId, intervalMinutes: 120 }]);
    repository.claimDueOrderSchedule.mockResolvedValue(true);
    repository.hasActiveOrderCommand.mockResolvedValue(hasActiveCommand);

    await service.dispatchDueOrderSchedules(now);

    expect(repository.createCommand).not.toHaveBeenCalled();
    expect(repository.postponeOrderSchedule).toHaveBeenCalledWith('schedule-1', now);
  });
});
