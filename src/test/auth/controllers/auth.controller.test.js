const authManager = require('../../../modules/auth/services/authManager.service');
const authController = require('../../../modules/auth/controllers/auth.controller');

jest.mock('../../../modules/auth/services/authManager.service');

describe('authController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      profile: {
        _id: '507f1f77bcf86cd799439012',
        accountId: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        fullName: 'Admin',
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
    expect(response.data.roles).toEqual(['ADMIN']);
    expect(response.data.permissions).toEqual(['AUTH:READ']);
    expect(response.data.scopes).toEqual([expect.objectContaining({
      assignmentId: 'team-assignment',
      scopeType: 'team',
    })]);
  });
});
