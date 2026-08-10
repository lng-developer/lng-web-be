const { createAuthRateLimit } = require('../../../src/modules/auth/middlewares/authRateLimit');

function createResponse() {
  return {
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('auth rate limit', () => {
  test('rejects the request after the configured limit per IP', () => {
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
});
