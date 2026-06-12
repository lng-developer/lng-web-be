const mongoose = require('mongoose');
const accountRepository = require('../repositories/account.repository');
const userProfileRepository = require('../repositories/userProfile.repository');
const roleRepository = require('../repositories/role.repository');
const { hashPassword } = require('../../../shared/utils/crypto');
const { accountStatuses } = require('../constants/auth.constants');
const authManager = require('./authManager.service');

jest.mock('../repositories/account.repository');
jest.mock('../repositories/userProfile.repository');
jest.mock('../repositories/role.repository');

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
    expect(accountRepository.appendSession).toHaveBeenCalledTimes(1);
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
