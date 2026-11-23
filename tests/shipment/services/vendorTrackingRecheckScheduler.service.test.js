jest.mock('../../../src/modules/shipment/services/shipment.service', () => ({
  recheckSubmittedVendorTracking: jest.fn(),
}));
jest.mock('../../../src/modules/shipment/services/trackingSyncConfig.service', () => ({
  get: jest.fn(),
  recordRun: jest.fn(),
}));
jest.mock('../../../src/shared/utils/logger', () => ({ info: jest.fn(), warn: jest.fn() }));

const shipmentService = require('../../../src/modules/shipment/services/shipment.service');
const trackingSyncConfigService = require('../../../src/modules/shipment/services/trackingSyncConfig.service');
const scheduler = require('../../../src/modules/shipment/services/vendorTrackingRecheckScheduler.service');
const logger = require('../../../src/shared/utils/logger');

describe('vendorTrackingRecheckScheduler', () => {
  afterEach(() => {
    scheduler.stopVendorTrackingRecheckScheduler();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('runs a manual tracking sync with the persisted batch size and caller scope', async () => {
    trackingSyncConfigService.get.mockResolvedValue({ enabled: false, intervalMinutes: 15, batchSize: 25 });
    shipmentService.recheckSubmittedVendorTracking.mockResolvedValue({
      checked: 2, applied: 1, skipped: 1, failed: 0,
    });

    await scheduler.runOnce({
      system: false,
      source: 'HTTP',
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(shipmentService.recheckSubmittedVendorTracking).toHaveBeenCalledWith({ limit: 25, perVendor: true }, expect.objectContaining({
      system: false,
      source: 'HTTP',
      permissions: ['SHIPMENTS:WRITE'],
    }));
    expect(trackingSyncConfigService.recordRun).toHaveBeenCalledWith({
      checked: 2, applied: 1, skipped: 1, failed: 0,
    }, expect.objectContaining({ system: false, source: 'HTTP' }), {
      startedAt: expect.any(Date), finishedAt: expect.any(Date),
    });
  });

  test('measures the actual run interval instead of two completion timestamps', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-23T08:00:00Z'));
    trackingSyncConfigService.get.mockResolvedValue({ batchSize: 50 });
    shipmentService.recheckSubmittedVendorTracking.mockImplementationOnce(async () => {
      jest.setSystemTime(new Date('2026-11-23T08:00:12Z'));
      return { checked: 2, applied: 2, skipped: 0, failed: 0 };
    });
    await scheduler.runOnce();
    expect(trackingSyncConfigService.recordRun).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), {
      startedAt: new Date('2026-11-23T08:00:00Z'), finishedAt: new Date('2026-11-23T08:00:12Z'),
    });
    expect(logger.info).toHaveBeenCalledWith('vendor_tracking_recheck_completed', expect.objectContaining({ durationMs: 12000 }));
  });

  test('records failed run duration and releases the local running guard', async () => {
    trackingSyncConfigService.get.mockResolvedValue({ batchSize: 50 });
    shipmentService.recheckSubmittedVendorTracking.mockRejectedValueOnce(new Error('failure'));
    await expect(scheduler.runOnce()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('vendor_tracking_recheck_failed', expect.objectContaining({ durationMs: expect.any(Number) }));
    shipmentService.recheckSubmittedVendorTracking.mockResolvedValueOnce({ checked: 0 });
    await expect(scheduler.runOnce()).resolves.toEqual({ checked: 0 });
  });
});
