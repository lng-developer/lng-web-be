const { spawn, spawnSync } = require('child_process');
const net = require('net');
const Redis = require('ioredis');
const redisConfig = require('../../../src/config/redis');
const { clientGuardKey, withClientGuard, retryAfterMs } = require('../../../src/modules/shipment/services/vendorTrackingGuard.service');

test('parses numeric and HTTP-date Retry-After headers', () => {
  expect(retryAfterMs('125')).toBe(125000);
  expect(retryAfterMs('Sun, 22 Nov 2026 12:01:00 GMT', Date.parse('2026-11-22T12:00:00Z'))).toBe(60000);
  expect(retryAfterMs('invalid')).toBe(0);
});

const redisAvailable = spawnSync('redis-server', ['--version'], { windowsHide: true }).status === 0;
(redisAvailable ? describe : describe.skip)('shared vendor guard on isolated Redis', () => {
  let server, a, b;
  beforeAll(async () => {
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    server = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '""', '--appendonly', 'no'], {
      stdio: 'ignore', windowsHide: true,
    });
    a = new Redis(port, '127.0.0.1', { retryStrategy: () => 50, maxRetriesPerRequest: 100 });
    b = a.duplicate();
    a.on('error', () => {});
    b.on('error', () => {});
    await Promise.all([a.ping(), b.ping()]);
  });
  afterAll(() => { a?.disconnect(); b?.disconnect(); server?.kill(); });

  test('a second process can use another client while the slow client and global slots stay bounded', async () => {
    const getter = jest.spyOn(redisConfig, 'getRedisClient').mockReturnValue(a);
    let releaseA, releaseB, enteredA, enteredB;
    const first = new Promise(resolve => { enteredA = resolve; });
    const second = new Promise(resolve => { enteredB = resolve; });
    const slow = withClientGuard('VENDOR', clientGuardKey({ apiKey: 'a' }), () => new Promise(resolve => { releaseA = resolve; enteredA(); }));
    await first;
    getter.mockReturnValue(b);
    await expect(withClientGuard('VENDOR', clientGuardKey({ apiKey: 'a' }), jest.fn())).rejects.toMatchObject({ trackingBusy: true });
    const other = withClientGuard('VENDOR', clientGuardKey({ apiKey: 'b' }), () => new Promise(resolve => { releaseB = resolve; enteredB(); }));
    await second;
    await expect(withClientGuard('VENDOR', clientGuardKey({ apiKey: 'c' }), jest.fn())).rejects.toMatchObject({ trackingBusy: true });
    releaseA(); releaseB();
    await Promise.all([slow, other]);
    const limited = Object.assign(new Error('429'), { vendorHttpStatus: 429, retryAfter: '90' });
    await expect(withClientGuard('VENDOR', clientGuardKey({ apiKey: 'a' }), async () => { throw limited; })).rejects.toBe(limited);
    await expect(withClientGuard('VENDOR', clientGuardKey({ apiKey: 'a' }), jest.fn())).rejects.toMatchObject({ trackingBusy: true });
    await expect(withClientGuard('VENDOR', clientGuardKey({ apiKey: 'b' }), async () => 'ok')).resolves.toBe('ok');
    getter.mockRestore();
  });
});
