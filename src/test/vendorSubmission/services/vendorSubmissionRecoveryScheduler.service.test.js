jest.mock('../../../modules/vendorSubmission/public', () => ({
  recheckReadyProductionTasks: jest.fn(),
}));

jest.mock('../../../shared/utils/logger', () => ({ info: jest.fn(), warn: jest.fn() }));

describe('vendorSubmissionRecoveryScheduler', () => {
  let scheduler;
  let vendorSubmissionPublic;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.VENDOR_SUBMISSION_RECOVERY_ENABLED;
    vendorSubmissionPublic = require('../../../modules/vendorSubmission/public');
    scheduler = require('../../../modules/vendorSubmission/services/vendorSubmissionRecoveryScheduler.service');
  });

  afterEach(() => scheduler.stopVendorSubmissionRecoveryScheduler());

  test('is disabled by default', () => {
    expect(scheduler.startVendorSubmissionRecoveryScheduler()).toBeNull();
  });

  test('prevents overlapping recovery runs', async () => {
    let resolveRun;
    vendorSubmissionPublic.recheckReadyProductionTasks.mockReturnValueOnce(new Promise((resolve) => {
      resolveRun = resolve;
    }));

    const first = scheduler.runOnce();
    expect(await scheduler.runOnce()).toBeNull();
    resolveRun({ checked: 1, submitted: 1, failed: 0 });
    await first;

    expect(vendorSubmissionPublic.recheckReadyProductionTasks).toHaveBeenCalledTimes(1);
  });
});
