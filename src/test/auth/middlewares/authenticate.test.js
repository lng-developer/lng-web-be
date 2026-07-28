const authManager = require('../../../modules/auth/services/authManager.service');
const authenticate = require('../../../modules/auth/middlewares/authenticate');

jest.mock('../../../modules/auth/services/authManager.service');

function runAuthenticate(req) {
  return new Promise((resolve) => {
    authenticate(req, {}, (error) => resolve(error));
  });
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('attaches req.auth for a valid bearer token', async () => {
    authManager.verifyAccessToken.mockReturnValue({ sub: 'account-id' });
    authManager.getCurrentAccount.mockResolvedValue({
      account: { _id: 'account-id', email: 'admin@example.com' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    authManager.buildAuthContext.mockReturnValue({
      accountId: 'account-id',
      email: 'admin@example.com',
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });

    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer access-token' : undefined)),
    };

    const error = await runAuthenticate(req);

    expect(error).toBeUndefined();
    expect(authManager.getCurrentAccount).toHaveBeenCalledWith('account-id', 0);
    expect(req.auth).toEqual({
      accountId: 'account-id',
      email: 'admin@example.com',
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
  });

  test('passes tokenVersion claim when present', async () => {
    authManager.verifyAccessToken.mockReturnValue({ sub: 'account-id', tokenVersion: 3 });
    authManager.getCurrentAccount.mockResolvedValue({
      account: { _id: 'account-id', email: 'admin@example.com', tokenVersion: 3 },
      roles: ['ADMIN'],
      permissions: ['AUTH:READ'],
    });
    authManager.buildAuthContext.mockReturnValue({
      accountId: 'account-id',
      email: 'admin@example.com',
      roles: ['ADMIN'],
      permissions: ['AUTH:READ'],
    });

    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer access-token' : undefined)),
    };

    const error = await runAuthenticate(req);

    expect(error).toBeUndefined();
    expect(authManager.getCurrentAccount).toHaveBeenCalledWith('account-id', 3);
  });

  test('rejects missing bearer token with 401', async () => {
    const req = {
      get: jest.fn(() => undefined),
    };

    const error = await runAuthenticate(req);

    expect(error).toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
  });

  test('rejects non-string authorization header without crashing', async () => {
    const req = {
      get: jest.fn(() => ['Bearer access-token']),
    };

    const error = await runAuthenticate(req);

    expect(error).toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
    expect(authManager.verifyAccessToken).not.toHaveBeenCalled();
  });

  test('maps JWT validation errors to 401', async () => {
    const jwtError = new Error('jwt malformed');
    jwtError.name = 'JsonWebTokenError';
    authManager.verifyAccessToken.mockImplementation(() => {
      throw jwtError;
    });

    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer bad-token' : undefined)),
    };

    const error = await runAuthenticate(req);

    expect(error).toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
  });

  test('forwards database or system errors without masking as 401', async () => {
    const systemError = new Error('MongoNetworkError');
    authManager.verifyAccessToken.mockReturnValue({ sub: 'account-id' });
    authManager.getCurrentAccount.mockRejectedValue(systemError);

    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer access-token' : undefined)),
    };

    const error = await runAuthenticate(req);

    expect(error).toBe(systemError);
  });
});
