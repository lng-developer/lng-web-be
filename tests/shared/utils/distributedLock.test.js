jest.mock('../../../src/config', () => ({
  redis: {
    enabled: true,
  },
  log: {
    level: 'silent',
    format: 'json',
  },
}));

jest.mock('../../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
}));

const config = require('../../../src/config');
const { getRedisClient } = require('../../../src/config/redis');
const {
  acquireLock,
  releaseLock,
  withDistributedLock,
} = require('../../../src/shared/utils/distributedLock');

describe('distributedLock utility', () => {
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();
    config.redis.enabled = true;
    mockRedis = {
      status: 'ready',
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    getRedisClient.mockReturnValue(mockRedis);
  });

  describe('acquireLock', () => {
    test('acquires lock when Redis is ready', async () => {
      const token = await acquireLock('test-job', 30000);
      expect(typeof token).toBe('string');
      expect(mockRedis.set).toHaveBeenCalledWith('lock:test-job', token, 'PX', 30000, 'NX');
    });

    test('returns null when lock is already held (NX returned null)', async () => {
      mockRedis.set.mockResolvedValue(null);
      const token = await acquireLock('busy-job', 30000);
      expect(token).toBeNull();
    });

    test('returns fallback token when Redis is disabled', async () => {
      config.redis.enabled = false;
      const token = await acquireLock('disabled-job', 30000);
      expect(token).toBe('fallback-local-lock');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    test('returns null when Redis status is not ready', async () => {
      mockRedis.status = 'connecting';
      const token = await acquireLock('connecting-job', 30000);
      expect(token).toBeNull();
    });

    test('returns null and handles Redis error gracefully', async () => {
      mockRedis.set.mockRejectedValue(new Error('Connection timeout'));
      const token = await acquireLock('error-job', 30000);
      expect(token).toBeNull();
    });
  });

  describe('releaseLock', () => {
    test('releases lock using atomic Lua script', async () => {
      const released = await releaseLock('test-job', 'token-123');
      expect(released).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
        1,
        'lock:test-job',
        'token-123'
      );
    });

    test('returns true without calling Redis when token is fallback-local-lock', async () => {
      const released = await releaseLock('test-job', 'fallback-local-lock');
      expect(released).toBe(true);
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    test('returns false when token mismatch in Lua script (eval returns 0)', async () => {
      mockRedis.eval.mockResolvedValue(0);
      const released = await releaseLock('test-job', 'wrong-token');
      expect(released).toBe(false);
    });
  });

  describe('withDistributedLock', () => {
    test('executes callback and releases lock upon completion', async () => {
      const mockTask = jest.fn().mockResolvedValue('task-result');
      const result = await withDistributedLock('batch-job', 10000, mockTask);

      expect(result).toBe('task-result');
      expect(mockTask).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    test('skips callback and returns null if lock cannot be acquired', async () => {
      mockRedis.set.mockResolvedValue(null);
      const mockTask = jest.fn();
      const result = await withDistributedLock('batch-job', 10000, mockTask);

      expect(result).toBeNull();
      expect(mockTask).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    test('releases lock even if callback throws', async () => {
      const mockTask = jest.fn().mockRejectedValue(new Error('Boom!'));

      await expect(withDistributedLock('batch-job', 10000, mockTask)).rejects.toThrow('Boom!');
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });
  });
});
