const authManager = require('../services/authManager.service');
const authenticate = require('./authenticate');

jest.mock('../services/authManager.service');

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
      profile: { _id: 'profile-id' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    authManager.buildAuthContext.mockReturnValue({
      accountId: 'account-id',
      profileId: 'profile-id',
      email: 'admin@example.com',
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });

    const req = {
      get: jest.fn((header) => (header === 'authorization' ? 'Bearer access-token' : undefined)),
    };

    const error = await runAuthenticate(req);

    expect(error).toBeUndefined();
    expect(req.auth).toEqual({
      accountId: 'account-id',
      profileId: 'profile-id',
      email: 'admin@example.com',
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
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
});
