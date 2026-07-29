const config = require('../../../config');
const authManager = require('../../../modules/auth/services/authManager.service');
const authController = require('../../../modules/auth/controllers/auth.controller');

jest.mock('../../../modules/auth/services/authManager.service');

describe('authController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('enabled registration forwards bounded request context without changing the payload', async () => {
    const previous = config.auth.registerEnabled;
    config.auth.registerEnabled = true;
    authManager.register.mockResolvedValue({ account: { id: 'account-id' } });
    const req = {
      body: { email: 'new@example.com', password: 'valid-password' },
      id: 'register-request',
      ip: '127.0.0.5',
      get: jest.fn().mockReturnValue('register-agent'),
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    try {
      await authController.register(req, res);
    } finally {
      config.auth.registerEnabled = previous;
    }

    expect(authManager.register).toHaveBeenCalledWith(
      'new@example.com', 'valid-password', undefined,
      { requestId: 'register-request', ipAddress: '127.0.0.5', userAgent: 'register-agent' },
    );
    expect(res.status).toHaveBeenCalledWith(201);
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

  test('changeOwnPassword validates and returns a safe account DTO', async () => {
    authManager.changeOwnPassword.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      email: 'staff@example.com',
      status: 'active',
      mustChangePassword: false,
      passwordHash: 'secret-hash',
      passwordSalt: 'secret-salt',
    });
    const req = {
      auth: { accountId: '507f1f77bcf86cd799439011' },
      body: { currentPassword: '123456', newPassword: 'NewStrongPassword1!' },
      id: 'change-password-request',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('change-password-agent'),
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await authController.changeOwnPassword(req, res);

    expect(authManager.changeOwnPassword).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011', req.body,
      {
        requestId: 'change-password-request',
        ipAddress: '127.0.0.1',
        userAgent: 'change-password-agent',
      },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual(expect.objectContaining({
      id: '507f1f77bcf86cd799439011',
      mustChangePassword: false,
    }));
    expect(res.json.mock.calls[0][0].data.passwordHash).toBeUndefined();
    expect(res.json.mock.calls[0][0].data.passwordSalt).toBeUndefined();
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
