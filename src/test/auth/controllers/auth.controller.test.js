const authManager = require('../../../modules/auth/services/authManager.service');
const authController = require('../../../modules/auth/controllers/auth.controller');

jest.mock('../../../modules/auth/services/authManager.service');

describe('authController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('login forwards an employee code identifier to auth manager', async () => {
    authManager.login.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
    const req = {
      body: { identifier: 'J2501', password: 'secret' },
      id: 'request-id',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-agent'),
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await authController.login(req, res);

    expect(authManager.login).toHaveBeenCalledWith('J2501', 'secret', {
      requestId: 'request-id',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test.each([
    ['refresh', { refreshToken: 'refresh-token' }, 'refreshSession', 200],
    ['logout', { refreshToken: 'refresh-token' }, 'logout', 204],
  ])('%s forwards request context separately', async (method, body, serviceMethod, status) => {
    authManager[serviceMethod].mockResolvedValue({ accessToken: 'access', refreshToken: 'next-refresh' });
    const req = {
      body,
      id: `${method}-request`,
      ip: '127.0.0.2',
      get: jest.fn().mockReturnValue(`${method}-agent`),
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    };

    await authController[method](req, res);

    expect(authManager[serviceMethod]).toHaveBeenCalledWith('refresh-token', {
      requestId: `${method}-request`,
      ipAddress: '127.0.0.2',
      userAgent: `${method}-agent`,
    });
    expect(res.status).toHaveBeenCalledWith(status);
  });

  test('me maps auth account through DTO and does not leak password fields', async () => {
    authManager.getCurrentAccount.mockResolvedValue({
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        passwordHash: 'secret-hash',
        passwordSalt: 'secret-salt',
        status: 'active',
      },
      roles: ['ADMIN'],
      permissions: ['AUTH:READ'],
      scopes: [
        {
          assignmentId: 'global-assignment',
          scopeType: 'global',
          scopeId: null,
          roles: ['ADMIN'],
          permissions: ['AUTH:READ'],
        },
        {
          assignmentId: 'team-assignment',
          scopeType: 'team',
          scopeId: '507f1f77bcf86cd799439088',
          roles: ['LEADER'],
          permissions: ['TEAM_MEMBERS:READ'],
        },
      ],
    });
    const req = { auth: { accountId: '507f1f77bcf86cd799439011' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await authController.me(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.data.account).toEqual(expect.objectContaining({
      id: '507f1f77bcf86cd799439011',
      email: 'admin@example.com',
      status: 'active',
    }));
    expect(response.data.account.passwordHash).toBeUndefined();
    expect(response.data.account.passwordSalt).toBeUndefined();
    expect(response.data).not.toHaveProperty('profile');
    expect(response.data.roles).toEqual(['ADMIN']);
    expect(response.data.permissions).toEqual(['AUTH:READ']);
    expect(response.data.scopes).toEqual([expect.objectContaining({
      assignmentId: 'team-assignment',
      scopeType: 'team',
    })]);
  });
});
