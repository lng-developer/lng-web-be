jest.mock('../../../src/modules/shipment/services/shipment.service', () => ({
  recheckSubmittedVendorTracking: jest.fn(),
}));

jest.mock('../../../src/shared/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
}));

describe('vendorTrackingRecheckScheduler.service', () => {
  let scheduler;
  let shipmentService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.VENDOR_TRACKING_RECHECK_ENABLED;
    delete process.env.VENDOR_TRACKING_RECHECK_INTERVAL_MS;
    delete process.env.VENDOR_TRACKING_RECHECK_LIMIT;
    shipmentService = require('../../../src/modules/shipment/services/shipment.service');
    scheduler = require('../../../src/modules/shipment/services/vendorTrackingRecheckScheduler.service');
  });

  afterEach(() => {
    scheduler.stopVendorTrackingRecheckScheduler();
  });

  test('is disabled by default', () => {
    expect(scheduler.startVendorTrackingRecheckScheduler()).toBeNull();
  });

  test('runOnce prevents overlapping runs', async () => {
    let resolveRun;
    shipmentService.recheckSubmittedVendorTracking.mockReturnValueOnce(new Promise((resolve) => {
      resolveRun = resolve;
    }));

    const first = scheduler.runOnce();
    const second = await scheduler.runOnce();
    resolveRun({
      checked: 1, applied: 1, skipped: 0, failed: 0,
    });
    await first;

    expect(second).toBeNull();
    expect(shipmentService.recheckSubmittedVendorTracking).toHaveBeenCalledTimes(1);
  });
});
