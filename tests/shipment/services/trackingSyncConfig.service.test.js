jest.mock('../../../src/modules/shipment/repositories/vendorTrackingPoll.repository', () => ({ summarizeByProvider: jest.fn() }));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));

jest.mock('../../../src/modules/shipment/repositories/trackingSyncConfig.repository', () => ({
  get: jest.fn(),
  upsert: jest.fn(),
}));

const auditPublic = require('../../../src/modules/audit/public');
const repository = require('../../../src/modules/shipment/repositories/trackingSyncConfig.repository');
const service = require('../../../src/modules/shipment/services/trackingSyncConfig.service');

describe('trackingSyncConfig.service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('persists an enabled tracking schedule and records a sanitized audit event', async () => {
    repository.upsert.mockResolvedValue({
      enabled: true,
      intervalMinutes: 15,
      batchSize: 50,
      updatedAt: new Date('2026-09-12T08:00:00.000Z'),
    });

    const result = await service.update({
      enabled: true,
      intervalMinutes: 15,
      batchSize: 50,
    }, {
      accountId: '660000000000000000130001',
      permissions: ['SHIPMENTS:WRITE'],
      source: 'HTTP',
    });

    expect(repository.upsert).toHaveBeenCalledWith({
      enabled: true,
      intervalMinutes: 15,
      batchSize: 50,
    });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SHIPMENT_TRACKING_SYNC_CONFIG_UPDATED',
      entityType: 'SHIPMENT_TRACKING_SYNC_CONFIG',
      entityId: 'DEFAULT',
      actorAccountId: '660000000000000000130001',
      source: 'HTTP',
    }), {});
    expect(result).toMatchObject({ enabled: true, intervalMinutes: 15, batchSize: 50 });
  });
});

describe('queue monitoring access and availability', () => {
  const config = require('../../../src/config');
  const polls = require('../../../src/modules/shipment/repositories/vendorTrackingPoll.repository');
  beforeEach(() => { jest.clearAllMocks(); config.shipment.trackingQueueEnabled = true; });
  afterEach(() => { config.shipment.trackingQueueEnabled = false; });
  test('does not expose global counts to shop-scoped writers', async () => {
    const result = await service.getWithMonitoring({ permissions: [], scopes: [{ permissions: ['SHIPMENTS:WRITE'] }] });
    expect(result.monitoring).toBeUndefined();
    expect(polls.summarizeByProvider).not.toHaveBeenCalled();
  });
  test('returns typed provider counts without raw database fields', async () => {
    polls.summarizeByProvider.mockResolvedValue([{ _id: 'LNG_GROUP', processing: 1, errors: 2 }]);
    const result = await service.getWithMonitoring({ permissions: ['SHIPMENTS:WRITE'] });
    expect(result.monitoring.available).toBe(true);
    expect(result.monitoring.providers[0]).toMatchObject({ provider: 'LNG_GROUP', processing: 1, errors: 2 });
    expect(result.monitoring.providers[0]._id).toBeUndefined();
  });
  test('database failure is unavailable, not zero counts', async () => {
    polls.summarizeByProvider.mockRejectedValue(new Error('offline'));
    expect((await service.getWithMonitoring({ permissions: ['SHIPMENTS:WRITE'] })).monitoring).toEqual({ available: false, providers: [] });
  });
});
