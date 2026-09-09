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
    repository.hasActiveImportCommand.mockResolvedValue(false);

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
    repository.hasActiveImportCommand.mockResolvedValue(false);

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
    repository.hasActiveImportCommand.mockResolvedValue(hasActiveCommand);

    await service.dispatchDueOrderSchedules(now);

    expect(repository.createCommand).not.toHaveBeenCalled();
    expect(repository.postponeOrderSchedule).toHaveBeenCalledWith('schedule-1', now, reason);
  });
});

describe('extension finance schedules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
  });

  test('queues up to seven uncompleted UTC transaction days with the agent lock', async () => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    repository.listDueFinanceSchedules.mockResolvedValue([{
      _id: 'schedule-1', source: 'TRANSACTIONS', shopId: 'shop-1', agentId: 'agent-1',
      lastSuccessfulDate: '2026-09-01', intervalMinutes: 1440,
    }]);
    repository.claimDueFinanceSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', lastSeenAt: now });
    repository.hasActiveImportCommand.mockResolvedValue(false);

    await service.dispatchDueFinanceSchedules(now);

    expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_TRANSACTIONS',
      dateFrom: '2026-09-02',
      dateTo: '2026-09-08',
      activeOrderKey: 'agent-1',
    }));
  });

  test('caps a transaction catch-up window at yesterday when fewer than seven dates are pending', async () => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    repository.listDueFinanceSchedules.mockResolvedValue([{
      _id: 'schedule-1', source: 'TRANSACTIONS', shopId: 'shop-1', agentId: 'agent-1',
      lastSuccessfulDate: '2026-09-02', intervalMinutes: 1440,
    }]);
    repository.claimDueFinanceSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', lastSeenAt: now });
    repository.hasActiveImportCommand.mockResolvedValue(false);

    await service.dispatchDueFinanceSchedules(now);

    expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_TRANSACTIONS',
      dateFrom: '2026-09-03',
      dateTo: '2026-09-08',
    }));
  });

  test('queues only yesterday when a transaction schedule has no checkpoint', async () => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    repository.listDueFinanceSchedules.mockResolvedValue([{
      _id: 'schedule-1', source: 'TRANSACTIONS', shopId: 'shop-1', agentId: 'agent-1',
      lastSuccessfulDate: null, intervalMinutes: 1440,
    }]);
    repository.claimDueFinanceSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', lastSeenAt: now });
    repository.hasActiveImportCommand.mockResolvedValue(false);

    await service.dispatchDueFinanceSchedules(now);

    expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_TRANSACTIONS',
      dateFrom: '2026-09-08',
      dateTo: '2026-09-08',
    }));
  });

  test('queues an enabled transaction schedule immediately using its checkpoint', async () => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const schedule = {
      _id: 'schedule-1', source: 'TRANSACTIONS', shopId: 'shop-1', agentId: 'agent-1',
      enabled: true, lastSuccessfulDate: '2026-09-07', intervalMinutes: 1440,
    };
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1', lastSeenAt: now });
    repository.findFinanceSchedule.mockResolvedValue(schedule);
    repository.hasActiveImportCommand.mockResolvedValue(false);
    repository.requestFinanceScheduleNow = jest.fn().mockResolvedValue(true);
    repository.listDueFinanceSchedules.mockResolvedValue([schedule]);
    repository.claimDueFinanceSchedule.mockResolvedValue(true);

    await service.requestFinanceScheduleNow('agent-1', 'TRANSACTIONS', { accountId: 'account-1' });

    expect(repository.requestFinanceScheduleNow).toHaveBeenCalledWith('schedule-1', now);
    expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_TRANSACTIONS', dateFrom: '2026-09-08', dateTo: '2026-09-08', activeOrderKey: 'agent-1',
    }));
  });

  test.each([
    ['agent is offline', { _id: 'agent-1', lastSeenAt: new Date('2026-09-09T11:58:00.000Z') }, false, 'AGENT_OFFLINE'],
    ['an import is active', { _id: 'agent-1', lastSeenAt: new Date('2026-09-09T11:59:00.000Z') }, true, 'ACTIVE_IMPORT_COMMAND'],
  ])('postpones the finance schedule when %s', async (_label, agent, hasActiveCommand, reason) => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    repository.listDueFinanceSchedules.mockResolvedValue([{
      _id: 'schedule-1', source: 'SETTLEMENTS', shopId: 'shop-1', agentId: 'agent-1', intervalMinutes: 1440,
    }]);
    repository.claimDueFinanceSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue(agent);
    repository.hasActiveImportCommand.mockResolvedValue(hasActiveCommand);

    await service.dispatchDueFinanceSchedules(now);

    expect(repository.createCommand).not.toHaveBeenCalled();
    expect(repository.postponeFinanceSchedule).toHaveBeenCalledWith('schedule-1', now, reason);
  });
});
