const mockDisconnectDatabase = jest.fn();
const mockDisconnectRedis = jest.fn();
const mockConnectRedis = jest.fn();
const mockConnectDatabase = jest.fn();
const mockCloseHttp = jest.fn();
const mockCloseWorker = jest.fn();
const mockAttachListener = jest.fn();
const mockDetachListener = jest.fn();
const mockStartScheduler = jest.fn();
const mockStopScheduler = jest.fn();
const mockListen = jest.fn();
const mockStartWorker = jest.fn();
const mockReadyWorker = jest.fn();
const mockOnWorker = jest.fn();
let mockConfig;
const mockWorker = {
  close: mockCloseWorker,
  waitUntilReady: mockReadyWorker,
  on: mockOnWorker,
};

jest.mock('../../src/config', () => mockConfig);
jest.mock('../../src/config/database', () => ({
  connectDatabase: mockConnectDatabase,
  disconnectDatabase: mockDisconnectDatabase,
}));
jest.mock('../../src/config/redis', () => ({
  connectRedis: mockConnectRedis,
  disconnectRedis: mockDisconnectRedis,
}));
jest.mock('../../src/app', () => () => ({ listen: mockListen }));
jest.mock('../../src/realtime/chatSocket', () => ({
  attachChatSocket: () => ({ close: mockCloseHttp }),
}));
jest.mock('../../src/shared/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/runtime/notificationRelay', () => ({
  connectNotificationRelay: () => () => {},
}));
jest.mock('../../src/config/queue', () => ({ connectQueueProducers: () => () => {} }));
jest.mock('../../src/runtime/workers', () => ({
  startWorkers: (register) => {
    const worker = mockStartWorker();
    register(worker);
    return [worker];
  },
}));
jest.mock('../../src/runtime/schedulers', () => ({
  startSchedulers: async (registerStop) => {
    registerStop(mockStopScheduler);
    await mockStartScheduler();
  },
}));
jest.mock('../../src/modules/integration/public', () => ({
  teamsChat: {
    attachTeamsOutboundListener: mockAttachListener,
    detachTeamsOutboundListener: mockDetachListener,
  },
}));

function boot(role, overrides = {}) {
  jest.resetModules();
  mockConfig = {
    runtime: { role },
    backgroundJobsEnabled: true, outboundEnabled: true,
    redis: { enabled: true },
    mapping: { durableSideEffectsEnabled: true },
    finance: { durableRecalculationEnabled: true },
    shipment: { trackingQueueEnabled: true },
    ...overrides,
  };
  return require('../../src/server').bootstrap();
}

beforeEach(() => {
  jest.resetAllMocks();
  mockStartWorker.mockReturnValue(mockWorker);
  mockListen.mockImplementation(() => ({
    once(event, handler) {
      if (event === 'listening') queueMicrotask(handler);
      return this;
    },
    removeListener() {},
  }));
});

test.each([
  ['api', true, false, false],
  ['worker', false, true, false],
  ['scheduler', false, false, true],
  ['combined', true, true, true],
])('%s starts only its own components', async (role, http, worker, scheduler) => {
  const { shutdown } = await boot(role);
  expect(mockListen).toHaveBeenCalledTimes(Number(http));
  expect(mockAttachListener).toHaveBeenCalledTimes(Number(http));
  expect(mockStartWorker).toHaveBeenCalledTimes(Number(worker));
  expect(mockReadyWorker).toHaveBeenCalledTimes(Number(worker));
  expect(mockStartScheduler).toHaveBeenCalledTimes(Number(scheduler));
  await shutdown('test');
  expect(mockDetachListener).toHaveBeenCalledTimes(Number(http));
});

test('combined mode retains Mongo-only startup', async () => {
  const { shutdown } = await boot('combined', {
    redis: { enabled: false }, mapping: {}, finance: {}, shipment: {},
  });
  expect(mockListen).toHaveBeenCalledTimes(1);
  expect(mockStartWorker).not.toHaveBeenCalled();
  expect(mockStartScheduler).toHaveBeenCalledTimes(1);
  expect(mockConnectRedis).not.toHaveBeenCalled();
  await shutdown();
  expect(mockDisconnectRedis).not.toHaveBeenCalled();
});

test('combined rejects durable queues when Redis is disabled', async () => {
  await expect(boot('combined', { redis: { enabled: false } })).rejects.toThrow('Durable');
  expect(mockConnectDatabase).not.toHaveBeenCalled();
});

test.each([
  ['Redis', { redis: { enabled: false } }],
  ['durable mapping', { mapping: {} }],
  ['durable finance', { finance: {} }],
  ['tracking queue', { shipment: {} }],
])('split mode fails closed if %s is disabled', async (_, override) => {
  await expect(boot('api', override)).rejects.toThrow('Split runtime');
  expect(mockConnectDatabase).not.toHaveBeenCalled();
  expect(mockListen).not.toHaveBeenCalled();
});

test('failed Redis startup leaves HTTP closed and releases the Mongo connection', async () => {
  mockConnectRedis.mockRejectedValueOnce(new Error('Redis unavailable'));
  await expect(boot('api')).rejects.toThrow('Redis unavailable');
  expect(mockListen).not.toHaveBeenCalled();
  expect(mockDisconnectDatabase).toHaveBeenCalledTimes(1);
  expect(mockDisconnectRedis).toHaveBeenCalledTimes(1);
});

test('failed worker startup drains registered workers before releasing connections', async () => {
  mockReadyWorker.mockRejectedValueOnce(new Error('Worker unavailable'));
  await expect(boot('combined')).rejects.toThrow('Worker unavailable');
  expect(mockListen).not.toHaveBeenCalled();
  expect(mockStartScheduler).not.toHaveBeenCalled();
  expect(mockCloseWorker).toHaveBeenCalledTimes(1);
  expect(mockCloseWorker.mock.invocationCallOrder[0]).toBeLessThan(mockDisconnectRedis.mock.invocationCallOrder[0]);
});

test('shutdown stops intake once and retains connections while work drains', async () => {
  let finishJob;
  mockCloseWorker.mockImplementationOnce(() => new Promise((resolve) => { finishJob = resolve; }));
  const { shutdown } = await boot('combined');
  const closed = shutdown('SIGTERM');
  expect(shutdown('SIGINT')).toBe(closed);
  expect(mockCloseHttp).toHaveBeenCalledTimes(1);
  expect(mockStopScheduler).toHaveBeenCalledTimes(1);
  expect(mockCloseWorker).toHaveBeenCalledTimes(1);
  expect(mockDisconnectDatabase).not.toHaveBeenCalled();
  expect(mockDisconnectRedis).not.toHaveBeenCalled();
  finishJob();
  await closed;
  expect(mockDisconnectDatabase).toHaveBeenCalledTimes(1);
  expect(mockDisconnectRedis).toHaveBeenCalledTimes(1);
});


test.each(['combined', 'worker', 'scheduler'])('%s respects disabled background jobs', async (role) => {
  const { shutdown } = await boot(role, { backgroundJobsEnabled: false, outboundEnabled: false });
  expect(mockStartWorker).not.toHaveBeenCalled();
  expect(mockStartScheduler).not.toHaveBeenCalled();
  expect(mockAttachListener).not.toHaveBeenCalled();
  await shutdown();
});

test('blocked outbound does not attach Teams listener', async () => {
  const { shutdown } = await boot('combined', { outboundEnabled: false });
  expect(mockAttachListener).not.toHaveBeenCalled();
  await shutdown();
});

test('PM2 profiles preserve production environment selection', () => {
  const combined = require('../../ecosystem.config').apps[0];
  for (const app of [combined, ...require('../../ecosystem.split.config').apps]) {
    expect(app.env.APP_ENV).toBe('production');
    expect(app.env.NODE_ENV).toBe('production');
  }
});
