const mongoose = require('mongoose');
const accountRepository = require('../../../modules/auth/repositories/account.repository');
const userProfileRepository = require('../../../modules/auth/repositories/userProfile.repository');
const roleRepository = require('../../../modules/auth/repositories/role.repository');
const accessAssignmentRepository = require('../../../modules/auth/repositories/accessAssignment.repository');
const { hashPassword } = require('../../../shared/utils/crypto');
const { accountStatuses } = require('../../../modules/auth/constants/auth.constants');
const authManager = require('../../../modules/auth/services/authManager.service');

jest.mock('../../../modules/auth/repositories/account.repository');
jest.mock('../../../modules/auth/repositories/userProfile.repository');
jest.mock('../../../modules/auth/repositories/role.repository');
jest.mock('../../../modules/auth/repositories/accessAssignment.repository');

describe('authManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('register creates Account and UserProfile inside one transaction session', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    accountRepository.findByNormalizedEmail.mockResolvedValue(null);
    roleRepository.findByCode.mockResolvedValue({ _id: 'role-id', code: 'OPERATOR' });
    accountRepository.create.mockResolvedValue({ _id: 'account-id', email: 'admin@example.com', status: 'active' });
    userProfileRepository.create.mockResolvedValue({ _id: 'profile-id', accountId: 'account-id', email: 'admin@example.com', fullName: 'Admin' });

    const result = await authManager.register('Admin@Example.com ', 'valid-password', 'Admin');

    expect(result.account.email).toBe('admin@example.com');
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(accountRepository.create.mock.calls[0][1]).toEqual({ session });
    expect(userProfileRepository.create.mock.calls[0][1]).toEqual({ session });
    expect(accessAssignmentRepository.create).toHaveBeenCalledWith({
      accountId: 'account-id',
      roleId: 'role-id',
      scopeType: 'global',
      scopeId: null,
      status: 'active',
    }, { session });
    expect(session.endSession).toHaveBeenCalledTimes(1);

    mongoose.startSession.mockRestore();
  });

  test('register maps duplicate key errors to conflict', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    accountRepository.findByNormalizedEmail.mockResolvedValue(null);
    roleRepository.findByCode.mockResolvedValue({ _id: 'role-id', code: 'OPERATOR' });
    accountRepository.create.mockRejectedValue({ code: 11000 });

    await expect(authManager.register('admin@example.com', 'valid-password', 'Admin')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(session.endSession).toHaveBeenCalledTimes(1);
    mongoose.startSession.mockRestore();
  });

  test('login validates password and returns tokens with resolved permissions', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    const authModel = {
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        passwordHash,
        passwordSalt,
        tokenVersion: 2,
        status: accountStatuses.ACTIVE,
      },
      profile: { _id: '507f1f77bcf86cd799439012', accountId: '507f1f77bcf86cd799439011', email: 'admin@example.com', fullName: 'Admin' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    };
    accountRepository.findAuthAccountByEmail.mockResolvedValue(authModel);
    accountRepository.appendSession.mockResolvedValue({});
    accountRepository.updateLastLogin.mockResolvedValue({});

    const result = await authManager.login('admin@example.com', 'valid-password', '127.0.0.1');

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.permissions).toEqual(['ORDERS:READ']);
    expect(result.scopes).toEqual([]);
    expect(authManager.verifyAccessToken(result.accessToken).tokenVersion).toBe(2);
    expect(accountRepository.appendSession).toHaveBeenCalledTimes(1);
  });

  test('login returns scoped access assignments when present', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    accountRepository.findAuthAccountByEmail.mockResolvedValue({
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        passwordHash,
        passwordSalt,
        status: accountStatuses.ACTIVE,
      },
      profile: null,
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
      scopes: [
        {
          assignmentId: '507f1f77bcf86cd799439098',
          scopeType: 'global',
          scopeId: null,
          roles: ['OPERATOR'],
          permissions: ['ORDERS:READ'],
        },
        {
          assignmentId: '507f1f77bcf86cd799439099',
          scopeType: 'team',
          scopeId: '507f1f77bcf86cd799439088',
          roles: ['TEAM_LEADER'],
          permissions: ['TEAM_MEMBERS:READ'],
        },
      ],
    });
    accountRepository.appendSession.mockResolvedValue({});
    accountRepository.updateLastLogin.mockResolvedValue({});

    const result = await authManager.login('admin@example.com', 'valid-password');

    expect(result.scopes).toEqual([{
      assignmentId: '507f1f77bcf86cd799439099',
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      resourceId: '507f1f77bcf86cd799439088',
      roles: ['TEAM_LEADER'],
      permissions: ['TEAM_MEMBERS:READ'],
    }]);
  });

  test('getCurrentAccount rejects stale access token versions', async () => {
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        tokenVersion: 3,
        status: accountStatuses.ACTIVE,
      },
      profile: null,
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });

    await expect(authManager.getCurrentAccount('507f1f77bcf86cd799439011', 2)).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
  });

  test('refresh rotates token and rejects reused old token after rotation', async () => {
    const account = { _id: '507f1f77bcf86cd799439011' };
    const authModel = {
      account: { _id: account._id, email: 'admin@example.com', status: accountStatuses.ACTIVE },
      profile: { _id: '507f1f77bcf86cd799439012', accountId: account._id, email: 'admin@example.com', fullName: 'Admin' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    };
    accountRepository.findAccountByActiveRefreshToken.mockResolvedValueOnce(account).mockResolvedValueOnce(null);
    accountRepository.findAuthAccountById.mockResolvedValue(authModel);
    accountRepository.rotateRefreshSession.mockResolvedValue({ _id: account._id });

    const result = await authManager.refreshSession('valid-refresh-token');

    expect(result.refreshToken).toBeTruthy();
    expect(accountRepository.rotateRefreshSession).toHaveBeenCalledTimes(1);
    await expect(authManager.refreshSession('valid-refresh-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
  });
});
