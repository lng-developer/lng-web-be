jest.mock('../../src/modules/audit/services/mongoIndexUsageSnapshot.service', () => ({
  collectAndStore: jest.fn(),
}));

jest.mock('../../src/shared/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
}));

describe('mongoIndexUsageSnapshotScheduler.service', () => {
  let scheduler;
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.MONGO_INDEX_USAGE_SNAPSHOT_ENABLED = 'true';
    service = require('../../src/modules/audit/services/mongoIndexUsageSnapshot.service');
    scheduler = require('../../src/modules/audit/services/mongoIndexUsageSnapshotScheduler.service');
  });

  afterEach(() => {
    scheduler.stopMongoIndexUsageSnapshotScheduler();
    delete process.env.MONGO_INDEX_USAGE_SNAPSHOT_ENABLED;
  });

  test('collects once on startup and prevents overlapping snapshots', async () => {
    let resolveSnapshot;
    service.collectAndStore.mockReturnValueOnce(new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    scheduler.startMongoIndexUsageSnapshotScheduler();
    const second = await scheduler.runOnce();
    resolveSnapshot({ capturedOn: '2026-08-25', collections: 81 });

    await Promise.resolve();
    expect(second).toBeNull();
    expect(service.collectAndStore).toHaveBeenCalledTimes(1);
  });
});
