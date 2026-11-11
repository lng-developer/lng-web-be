jest.mock('../repositories/extensionCommand.repository');
jest.mock('../../../auth/public', () => ({ canAccessScope: jest.fn() }));
jest.mock('../../../shipment/public', () => ({ findReadyForMarketplaceUpload: jest.fn() }));
jest.mock('../../amazonTrackingSubmission/public', () => ({ createSubmission: jest.fn() }));

const repository = require('../repositories/extensionCommand.repository');
const authPublic = require('../../../auth/public');
const shipmentPublic = require('../../../shipment/public');
const amazonTrackingSubmissionPublic = require('../../amazonTrackingSubmission/public');
const service = require('../services/extensionCommand.service');

describe('extension tracking schedules', () => {
  const now = new Date('2026-11-11T08:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
  });

  test('upserts a tracking schedule', async () => {
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1', lastSeenAt: now });
    repository.upsertTrackingSchedule.mockResolvedValue({ _id: 'sched-1', enabled: true });

    const result = await service.upsertTrackingSchedule(
      'agent-1',
      { enabled: true, intervalMinutes: 120 },
      { accountId: 'acc-1' },
    );

    expect(repository.upsertTrackingSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: 'shop-1',
        agentId: 'agent-1',
        enabled: true,
        intervalMinutes: 120,
      }),
    );
    expect(result).toEqual({ _id: 'sched-1', enabled: true });
  });

  test('requestTrackingScheduleNow creates submission when shipments are ready', async () => {
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1', lastSeenAt: new Date() });
    repository.hasActiveTrackingCommand.mockResolvedValue(false);
    shipmentPublic.findReadyForMarketplaceUpload.mockResolvedValue([
      { _id: 'ship-1' },
      { _id: 'ship-2' },
    ]);
    amazonTrackingSubmissionPublic.createSubmission.mockResolvedValue({ id: 'sub-1' });

    const result = await service.requestTrackingScheduleNow('agent-1', { accountId: 'acc-1' });

    expect(amazonTrackingSubmissionPublic.createSubmission).toHaveBeenCalledWith(
      { shopId: 'shop-1', agentId: 'agent-1', shipmentIds: ['ship-1', 'ship-2'] },
      { accountId: 'acc-1' },
    );
    expect(result).toEqual({
      message: 'Queued 2 shipments for upload to Amazon',
      batchCount: 2,
      submissionId: 'sub-1',
      queued: true,
    });
  });

  test('requestTrackingScheduleNow returns queued false when no shipments ready', async () => {
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1', lastSeenAt: new Date() });
    repository.hasActiveTrackingCommand.mockResolvedValue(false);
    shipmentPublic.findReadyForMarketplaceUpload.mockResolvedValue([]);

    const result = await service.requestTrackingScheduleNow('agent-1', { accountId: 'acc-1' });

    expect(amazonTrackingSubmissionPublic.createSubmission).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: 'No pending shipments ready for upload',
      batchCount: 0,
      queued: false,
    });
  });

  test('dispatchDueTrackingSchedules batches due shipments and creates submission', async () => {
    repository.listDueTrackingSchedules.mockResolvedValue([
      { _id: 'sched-1', shopId: 'shop-1', agentId: { _id: 'agent-1', lastSeenAt: now }, intervalMinutes: 120 },
    ]);
    repository.claimDueTrackingSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', lastSeenAt: now });
    repository.hasActiveTrackingCommand.mockResolvedValue(false);
    shipmentPublic.findReadyForMarketplaceUpload.mockResolvedValue([
      { _id: 'ship-1' },
    ]);
    amazonTrackingSubmissionPublic.createSubmission.mockResolvedValue({ id: 'sub-1' });

    await service.dispatchDueTrackingSchedules(now);

    expect(amazonTrackingSubmissionPublic.createSubmission).toHaveBeenCalledWith(
      { shopId: 'shop-1', agentId: 'agent-1', shipmentIds: ['ship-1'] },
      { system: true, permissions: ['ORDERS:WRITE'] },
    );
    expect(repository.markTrackingScheduleQueued).toHaveBeenCalledWith('sched-1', now, { batchCount: 1 });
  });

  test('dispatchDueTrackingSchedules postpones when agent is offline', async () => {
    const offlineTime = new Date('2026-11-10T00:00:00.000Z');
    repository.listDueTrackingSchedules.mockResolvedValue([
      { _id: 'sched-1', shopId: 'shop-1', agentId: { _id: 'agent-1', lastSeenAt: offlineTime }, intervalMinutes: 120 },
    ]);
    repository.claimDueTrackingSchedule.mockResolvedValue(true);
    repository.findAgentById.mockResolvedValue({ _id: 'agent-1', lastSeenAt: offlineTime });

    await service.dispatchDueTrackingSchedules(now);

    expect(repository.postponeTrackingSchedule).toHaveBeenCalledWith('sched-1', now, 'AGENT_OFFLINE');
    expect(amazonTrackingSubmissionPublic.createSubmission).not.toHaveBeenCalled();
  });
});
