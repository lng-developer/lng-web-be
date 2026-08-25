const {
  createAmazonAdsEmailImportScheduler,
} = require('../../../../src/modules/integration/amazonAdsEmail/services/amazonAdsEmailImportScheduler.service');

describe('amazonAdsEmailImportScheduler.service', () => {
  test('starts one immediate run and does not overlap it', async () => {
    let resolveRun;
    let firstRun = true;
    const runOnce = jest.fn(() => {
      if (!firstRun) return Promise.resolve();
      firstRun = false;
      return new Promise((resolve) => { resolveRun = resolve; });
    });
    const setInterval = jest.fn(() => 'timer');
    const clearInterval = jest.fn();
    const scheduler = createAmazonAdsEmailImportScheduler({ enabled: true, pollIntervalMs: 300000 }, {
      runOnce, setInterval, clearInterval, logger: { info: jest.fn(), warn: jest.fn() },
    });

    scheduler.start();
    expect(runOnce).toHaveBeenCalledTimes(1);
    const tick = setInterval.mock.calls[0][0];
    await tick();
    expect(runOnce).toHaveBeenCalledTimes(1);

    resolveRun();
    await Promise.resolve();
    await tick();
    expect(runOnce).toHaveBeenCalledTimes(2);
    scheduler.stop();
    expect(clearInterval).toHaveBeenCalledWith('timer');
  });

  test('does not schedule when Gmail import is disabled', () => {
    const setInterval = jest.fn();
    const scheduler = createAmazonAdsEmailImportScheduler({ enabled: false }, {
      runOnce: jest.fn(), setInterval, clearInterval: jest.fn(), logger: { info: jest.fn(), warn: jest.fn() },
    });

    scheduler.start();
    expect(setInterval).not.toHaveBeenCalled();
  });
});
