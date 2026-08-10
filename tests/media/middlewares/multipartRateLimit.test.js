const { createMultipartRateLimit } = require('../../../src/modules/media/middlewares/multipartRateLimit');

describe('multipartRateLimit', () => {
  test('limits repeated upload-control requests per account', () => {
    const middleware = createMultipartRateLimit({ windowMs: 60000, max: 2 });
    const req = { auth: { accountId: 'account-1' }, ip: '127.0.0.1' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);
    middleware(req, res, next);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMIT_ERROR' }));
  });
});
