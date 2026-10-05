const authManager = require('../../../src/modules/auth/services/authManager.service');
const extensionTokenService = require('../../../src/modules/auth/services/extensionToken.service');
const authenticate = require('../../../src/modules/auth/middlewares/authenticate');

jest.mock('../../../src/modules/auth/services/authManager.service');
jest.mock('../../../src/modules/auth/services/extensionToken.service');
jest.mock('../../../src/modules/hr/public', () => ({
  getEmployeeProfileByAccountId: jest.fn(),
}));

const hrPublic = require('../../../src/modules/hr/public');

function runAuthenticate(req) {
  return new Promise((resolve) => {
    authenticate(req, {}, (error) => resolve(error));
  });
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue(null);
  });

  test('attaches req.auth for a valid bearer token', async () => {
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({ isProfileUpdated: true });
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
      profileSetupRequired: false,
    });

    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer access-token' : undefined)),
    };

    const error = await runAuthenticate(req);

    expect(error).toBeUndefined();
    expect(authManager.getCurrentAccount).toHaveBeenCalledWith('account-id', 0);
    expect(hrPublic.getEmployeeProfileByAccountId).toHaveBeenCalledWith('account-id');
    expect(req.auth).toEqual({
      accountId: 'account-id',
      email: 'admin@example.com',
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
      profileSetupRequired: false,
    });
  });

  test('records auth account and employee profile durations on the request', async () => {
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({ isProfileUpdated: true });
    authManager.verifyAccessToken.mockReturnValue({ sub: 'account-id' });
    authManager.getCurrentAccount.mockResolvedValue({
      account: { _id: 'account-id', email: 'admin@example.com' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    authManager.buildAuthContext.mockReturnValue({ accountId: 'account-id' });
    const now = jest.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(3520)
      .mockReturnValueOnce(3520)
      .mockReturnValueOnce(3551);
    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer access-token' : undefined)),
    };

    try {
      await expect(runAuthenticate(req)).resolves.toBeUndefined();
      expect(req.authTimings).toEqual({ authAccount: 3420, employeeProfile: 31 });
    } finally {
      now.mockRestore();
    }
  });

  test('marks profile setup as required without blocking authentication when account has no employee profile', async () => {
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

    await expect(runAuthenticate(req)).resolves.toBeUndefined();
    expect(req.auth.profileSetupRequired).toBe(true);
  });

  test('passes tokenVersion claim when present', async () => {
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({ isProfileUpdated: true });
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

  test('attaches shop-scoped auth for a valid extension token without JWT lookup', async () => {
    const extensionAuth = {
      accountId: null,
      email: null,
      tokenType: 'EXTENSION',
      extensionTokenId: 'token-id',
      roles: [],
      permissions: [],
      scopes: [
        {
          assignmentId: 'token-id',
          scopeType: 'shop',
          scopeId: 'shop-id',
          roles: [],
          permissions: ['ORDERS:WRITE'],
        },
      ],
      profileSetupRequired: false,
      mustChangePassword: false,
    };
    extensionTokenService.authenticate.mockResolvedValue(extensionAuth);

    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer lng_ext_token' : undefined)),
    };

    const error = await runAuthenticate(req);

    expect(error).toBeUndefined();
    expect(req.auth).toEqual(extensionAuth);
    expect(authManager.verifyAccessToken).not.toHaveBeenCalled();
    expect(hrPublic.getEmployeeProfileByAccountId).not.toHaveBeenCalled();
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
