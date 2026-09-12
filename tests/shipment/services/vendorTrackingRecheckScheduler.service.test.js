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

describe('vendorTrackingRecheckScheduler', () => {
  afterEach(() => {
    scheduler.stopVendorTrackingRecheckScheduler();
    jest.clearAllMocks();
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

    expect(shipmentService.recheckSubmittedVendorTracking).toHaveBeenCalledWith({ limit: 25 }, expect.objectContaining({
      system: false,
      source: 'HTTP',
      permissions: ['SHIPMENTS:WRITE'],
    }));
    expect(trackingSyncConfigService.recordRun).toHaveBeenCalledWith({
      checked: 2, applied: 1, skipped: 1, failed: 0,
    }, expect.objectContaining({ system: false, source: 'HTTP' }));
  });
});
