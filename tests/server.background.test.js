const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function boot(backgroundJobsEnabled) {
  const started = [];
  const listen = jest.fn(() => ({ close: jest.fn() }));
  const connectRedis = jest.fn().mockResolvedValue();
  const services = new Proxy({}, {
    get: (_, key) => (...args) => {
      if (/^(start|attach)/.test(key)) started.push(key);
      return key === 'startExternalOrderImportWorkers' ? [] : undefined;
    },
  });
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8'), {
    require: (name) => {
      if (name === './app') return () => ({ listen });
      if (name === './config') return { backgroundJobsEnabled, redis: { enabled: true }, port: 3000 };
      if (name === './config/database') return { connectDatabase: async () => {} };
      if (name === './config/redis') return { connectRedis };
      if (name === './shared/utils/logger') return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      if (name === './realtime/chatSocket') return { attachChatSocket: () => ({ close: jest.fn() }) };
      if (name === './modules/integration/public') return { teamsChat: services, sqlAttendance: services };
      return services;
    },
    process: { on: jest.fn(), exit: jest.fn() },
  });
  await new Promise(setImmediate);
  return { started, listen, connectRedis };
}

test('API-only mode keeps HTTP and Redis available without workers, schedulers or outbound listener', async () => {
  const result = await boot(false);
  expect(result.listen).toHaveBeenCalledTimes(1);
  expect(result.connectRedis).toHaveBeenCalledTimes(1);
  expect(result.started).toEqual([]);
});

test('normal mode retains background startup', async () => {
  const { started, listen } = await boot(true);
  expect(listen).toHaveBeenCalledTimes(1);
  expect(started).toEqual(expect.arrayContaining([
    'startExternalOrderImportWorkers', 'startVendorTrackingRecheckScheduler',
    'startExtensionOrderScheduleScheduler', 'attachTeamsOutboundListener',
    'startMonthlyLeaveAccrualScheduler',
  ]));
});
