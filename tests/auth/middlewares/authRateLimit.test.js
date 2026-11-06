const { createAuthRateLimit } = require('../../../src/modules/auth/middlewares/authRateLimit');
const config = require('../../../src/config');
const { getRedisClient } = require('../../../src/config/redis');

jest.mock('../../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
}));

function createResponse() {
  return {
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('auth rate limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.redis.enabled = false;
  });

  test('rejects the request after the configured limit per IP (memory mode)', () => {
    const limiter = createAuthRateLimit({ windowMs: 60_000, max: 2 });
    const req = { ip: '127.0.0.1' };
    const next = jest.fn();

    limiter(req, createResponse(), next);
    limiter(req, createResponse(), next);
    const res = createResponse();
    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'RATE_LIMIT_ERROR' }),
    }));
  });

  test('uses Redis atomically when Redis is enabled and ready', async () => {
    config.redis.enabled = true;
    const mockRedis = {
      status: 'ready',
      eval: jest.fn()
        .mockResolvedValueOnce([1, 60000])
        .mockResolvedValueOnce([2, 59000])
        .mockResolvedValueOnce([3, 58000]),
    };
    getRedisClient.mockReturnValue(mockRedis);

    const limiter = createAuthRateLimit({ windowMs: 60_000, max: 2 });
    const req = { ip: '192.168.1.1', body: { email: 'admin@example.com' } };
    const next = jest.fn();

    await limiter(req, createResponse(), next);
    await limiter(req, createResponse(), next);

    const res = createResponse();
    await limiter(req, res, next);

    expect(mockRedis.eval).toHaveBeenCalledTimes(3);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '58');
  });

  test('falls back to memory limiter when Redis rejects', async () => {
    config.redis.enabled = true;
    const mockRedis = {
      status: 'ready',
      eval: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
    };
    getRedisClient.mockReturnValue(mockRedis);

    const limiter = createAuthRateLimit({ windowMs: 60_000, max: 1 });
    const req = { ip: '10.0.0.1' };
    const next = jest.fn();

    await limiter(req, createResponse(), next);
    const res = createResponse();
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
