const crypto = require('crypto');
const mongoose = require('mongoose');

const accountId = '660000000000000000000001';
const departmentId = '660000000000000000000002';
const teamId = '660000000000000000000003';

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn((authContext, permission, scope) => (authContext.permissions || []).includes(permission)
    || (authContext.scopes || []).some((granted) => granted.scopeType === scope.scopeType
      && String(granted.scopeId) === String(scope.scopeId)
      && (granted.permissions || []).includes(permission))),
  getCurrentAccount: jest.fn(),
}));
jest.mock('../../../src/modules/organization/public', () => ({
  getDepartmentById: jest.fn(),
  listAccountOrganizationSummaries: jest.fn(),
  listDepartmentsByIds: jest.fn(),
  getTeamById: jest.fn(),
  listTeamsByIds: jest.fn(),
  syncTeamMembership: jest.fn(),
  deactivateTeamMembership: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
}));
jest.mock('../../../src/modules/media/public', () => ({
  discardUnattachedAsset: jest.fn(),
  storeAsset: jest.fn(),
  withAssetLocalReadFile: jest.fn(),
}));
jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({
  create: jest.fn(),
  findByAccountId: jest.fn(),
  findByEmployeeCode: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  restore: jest.fn(),
  softDelete: jest.fn(),
  updateById: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const auditPublic = require('../../../src/modules/audit/public');
const organizationPublic = require('../../../src/modules/organization/public');
const mediaPublic = require('../../../src/modules/media/public');
const repository = require('../../../src/modules/hr/repositories/employeeProfile.repository');
const service = require('../../../src/modules/hr/services/employeeProfile.service');

describe('employeeProfile service', () => {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.getCurrentAccount.mockResolvedValue({ account: { _id: accountId, status: 'active' } });
    repository.findByAccountId.mockResolvedValue(null);
    repository.findByEmployeeCode.mockResolvedValue(null);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([]);
    organizationPublic.listDepartmentsByIds.mockResolvedValue([]);
    organizationPublic.listTeamsByIds.mockResolvedValue([]);
  });

  test('derives department from the selected active team', async () => {
    organizationPublic.getTeamById.mockResolvedValue({ id: teamId, departmentId, status: 'ACTIVE' });
    repository.create.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId,
      teamId,
    });

    const result = await service.createProfile({
      accountId,
      employeeCode: 'j2501',
      fullName: 'Jane Nguyen',
      teamId,
    }, { permissions: ['HR_EMPLOYEES:WRITE'] });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      employeeCode: 'J2501',
      departmentId,
      teamId,
    }));
    expect(result.departmentId).toBe(departmentId);
  });

  test('stores avatar bytes in Media and only the asset id on the HR profile', async () => {
    const profileId = '660000000000000000000004';
    const avatarAssetId = '660000000000000000000009';
    const current = { _id: profileId, accountId, employeeCode: 'J2501', fullName: 'Jane', departmentId };
    repository.findById.mockResolvedValue(current);
    mediaPublic.storeAsset.mockResolvedValue({ _id: avatarAssetId });
    repository.updateById.mockResolvedValue({ ...current, avatarAssetId, avatarUrl: null });

    const result = await service.uploadProfileAvatar(profileId, {
      buffer: pngBuffer,
      originalname: 'avatar.png',
      mimetype: 'image/png',
      size: 11,
    }, { accountId, permissions: ['HR_EMPLOYEES:WRITE'] });

    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'avatar.png',
      mimeType: 'image/png',
      metadata: expect.objectContaining({ source: 'HR_AVATAR', profileId }),
    }));
    expect(repository.updateById).toHaveBeenCalledWith(profileId, {
      avatarAssetId,
      avatarUrl: null,
    });
    expect(result.avatarAssetId).toBe(avatarAssetId);
  });

  test('allows an authenticated employee to upload their own avatar during setup', async () => {
    const profileId = '660000000000000000000004';
    const avatarAssetId = '660000000000000000000009';
    const current = { _id: profileId, accountId, employeeCode: 'J2501', fullName: 'Jane' };
    repository.findByAccountId.mockResolvedValue(current);
    mediaPublic.storeAsset.mockResolvedValue({ _id: avatarAssetId });
    repository.updateById.mockResolvedValue({ ...current, avatarAssetId, avatarUrl: null });

    const result = await service.uploadMyProfileAvatar({
      buffer: pngBuffer,
      originalname: 'avatar.png',
      mimetype: 'image/png',
      size: 11,
    }, { accountId });

    expect(result.avatarAssetId).toBe(avatarAssetId);
    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ profileId, uploadedBy: accountId }),
    }));
  });

  test('rejects non-image avatar files before Media storage', async () => {
    const profileId = '660000000000000000000004';
    repository.findById.mockResolvedValue({ _id: profileId, accountId, departmentId });

    await expect(service.uploadProfileAvatar(profileId, {
      buffer: Buffer.from('not-an-image'),
      originalname: 'avatar.pdf',
      mimetype: 'application/pdf',
      size: 12,
    }, { permissions: ['HR_EMPLOYEES:WRITE'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
  });

  test('streams a profile avatar through Media after HR read authorization', async () => {
    const profileId = '660000000000000000000004';
    const avatarAssetId = '660000000000000000000009';
    const callback = jest.fn().mockResolvedValue('streamed');
    repository.findById.mockResolvedValue({ _id: profileId, accountId, departmentId, avatarAssetId });
    mediaPublic.withAssetLocalReadFile.mockImplementation((_assetId, reader) => reader({
      mediaAsset: { mimeType: 'image/png', size: 11 },
      localPath: 'avatar.png',
    }));

    const result = await service.withProfileAvatar(
      profileId,
      { permissions: ['HR_EMPLOYEES:READ'] },
      callback,
    );

    expect(mediaPublic.withAssetLocalReadFile).toHaveBeenCalledWith(avatarAssetId, callback);
    expect(result).toBe('streamed');
  });

  test('streams an authenticated employee own avatar without HR permissions', async () => {
    const avatarAssetId = '660000000000000000000009';
    const callback = jest.fn().mockResolvedValue('streamed');
    repository.findByAccountId.mockResolvedValue({ _id: 'profile-1', accountId, avatarAssetId });
    mediaPublic.withAssetLocalReadFile.mockImplementation((_assetId, reader) => reader({
      mediaAsset: { mimeType: 'image/png', size: 11 },
      localPath: 'avatar.png',
    }));

    const result = await service.withMyProfileAvatar({ accountId }, callback);

    expect(mediaPublic.withAssetLocalReadFile).toHaveBeenCalledWith(avatarAssetId, callback);
    expect(result).toBe('streamed');
  });

  test('audits profile lifecycle mutations without employee PII', async () => {
    const profileId = '660000000000000000000004';
    const auth = { accountId, permissions: ['HR_EMPLOYEES:WRITE', 'HR_COMPENSATION:READ'] };
    const persisted = {
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      birthDate: '1990-01-01',
      phoneNumber: '0900000000',
      address: 'Private address',
      baseSalary: 10000000,
      departmentId,
      teamId,
      updatedAt: new Date('2026-07-29T01:00:00.000Z'),
    };
    organizationPublic.getDepartmentById.mockResolvedValue({ id: departmentId, status: 'ACTIVE' });
    organizationPublic.getTeamById.mockResolvedValue({ id: teamId, departmentId, status: 'ACTIVE' });
    repository.create.mockResolvedValue(persisted);
    repository.findById
      .mockResolvedValueOnce(persisted)
      .mockResolvedValueOnce(persisted)
      .mockResolvedValueOnce({ ...persisted, isDeleted: true })
      .mockResolvedValueOnce(persisted);
    repository.updateById.mockResolvedValue(persisted);
    repository.softDelete.mockResolvedValue({ ...persisted, isDeleted: true });
    repository.restore.mockResolvedValue({ ...persisted, isDeleted: false });

    await service.createProfile({
      accountId, employeeCode: 'J2501', fullName: 'Jane Nguyen', teamId,
    }, auth);
    await service.updateProfile(profileId, { jobTitle: 'Lead', phoneNumber: '0911111111' }, auth);
    await service.deleteProfile(profileId, auth);
    await service.restoreProfile(profileId, auth);
    await service.getProfile(profileId, auth, { includeSensitive: true });

    expect(auditPublic.record.mock.calls.map(([event]) => event.action)).toEqual([
      'HR_EMPLOYEE_PROFILE_CREATED',
      'HR_EMPLOYEE_PROFILE_UPDATED',
      'HR_EMPLOYEE_PROFILE_DELETED',
      'HR_EMPLOYEE_PROFILE_RESTORED',
    ]);
    for (const [event] of auditPublic.record.mock.calls) {
      expect(JSON.stringify(event)).not.toMatch(/Jane Nguyen|0900000000|0911111111|Private address|1990-01-01|10000000/);
    }
  });

  test('gives same-timestamp profile updates distinct server mutation identities', async () => {
    const profileId = '660000000000000000000004';
    const persisted = {
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId,
      teamId,
      updatedAt: new Date('2026-07-29T01:00:00.000Z'),
    };
    jest.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    repository.findById.mockResolvedValue(persisted);
    repository.updateById.mockResolvedValue(persisted);
    organizationPublic.getDepartmentById.mockResolvedValue({ id: departmentId, status: 'ACTIVE' });
    organizationPublic.getTeamById.mockResolvedValue({ id: teamId, departmentId, status: 'ACTIVE' });

    await service.updateProfile(profileId, { jobTitle: 'Lead' }, { accountId, permissions: ['HR_EMPLOYEES:WRITE'] });
    await service.updateProfile(profileId, { jobTitle: 'Manager' }, { accountId, permissions: ['HR_EMPLOYEES:WRITE'] });

    expect(auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey)).toEqual([
      `hr:hr_employee_profile_updated:${profileId}:00000000-0000-4000-8000-000000000001`,
      `hr:hr_employee_profile_updated:${profileId}:00000000-0000-4000-8000-000000000002`,
    ]);
  });

  test('rejects an avatar whose bytes do not match its PNG metadata', async () => {
    const profileId = '660000000000000000000004';
    repository.findById.mockResolvedValue({ _id: profileId, accountId, departmentId });

    await expect(service.uploadProfileAvatar(profileId, {
      buffer: Buffer.from('not-a-real-png'),
      originalname: 'avatar.png',
      mimetype: 'image/png',
    }, { permissions: ['HR_EMPLOYEES:WRITE'] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
  });

  test('discards the new avatar asset when profile persistence fails', async () => {
    const profileId = '660000000000000000000004';
    const avatarAssetId = '660000000000000000000009';
    repository.findById.mockResolvedValue({ _id: profileId, accountId, departmentId });
    mediaPublic.storeAsset.mockResolvedValue({ _id: avatarAssetId });
    repository.updateById.mockRejectedValue(new Error('profile write failed'));

    await expect(service.uploadProfileAvatar(profileId, {
      buffer: pngBuffer, originalname: 'avatar.png', mimetype: 'image/png',
    }, { permissions: ['HR_EMPLOYEES:WRITE'] })).rejects.toThrow('profile write failed');
    expect(mediaPublic.discardUnattachedAsset).toHaveBeenCalledWith(
      avatarAssetId, { source: 'HR_AVATAR', profileId }, 'HR_AVATAR_PROFILE_UPDATE_FAILED',
    );
  });

  test('discards the previous avatar after replacement succeeds', async () => {
    const profileId = '660000000000000000000004';
    const oldAssetId = '660000000000000000000008';
    const avatarAssetId = '660000000000000000000009';
    const current = { _id: profileId, accountId, departmentId, avatarAssetId: oldAssetId };
    repository.findById.mockResolvedValue(current);
    mediaPublic.storeAsset.mockResolvedValue({ _id: avatarAssetId });
    repository.updateById.mockResolvedValue({ ...current, avatarAssetId });

    await service.uploadProfileAvatar(profileId, {
      buffer: pngBuffer, originalname: 'avatar.png', mimetype: 'image/png',
    }, { permissions: ['HR_EMPLOYEES:WRITE'] });

    expect(mediaPublic.discardUnattachedAsset).toHaveBeenCalledWith(
      oldAssetId, { source: 'HR_AVATAR', profileId }, 'HR_AVATAR_REPLACED',
    );
  });

  test.each([
    ['delete', true, 'deleteProfile', 'softDelete'],
    ['restore', false, 'restoreProfile', 'restore'],
  ])('treats repeated %s as a no-op', async (_label, isDeleted, operation, repositoryMethod) => {
    const profileId = '660000000000000000000004';
    repository.findById.mockResolvedValue({
      _id: profileId, accountId, departmentId, employeeCode: 'J2501', fullName: 'Jane', isDeleted,
    });

    await service[operation](profileId, { permissions: ['HR_EMPLOYEES:WRITE'] });

    expect(repository[repositoryMethod]).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('rejects a partial date update that ends before persisted start date', async () => {
    const profileId = '660000000000000000000004';
    repository.findById.mockResolvedValue({
      _id: profileId, accountId, departmentId, teamId,
      startDate: new Date('2026-07-10T00:00:00.000Z'),
    });
    organizationPublic.getDepartmentById.mockResolvedValue({ id: departmentId, status: 'ACTIVE' });
    organizationPublic.getTeamById.mockResolvedValue({ id: teamId, departmentId, status: 'ACTIVE' });

    await expect(service.updateProfile(profileId, {
      endDate: new Date('2026-07-09T00:00:00.000Z'),
    }, { permissions: ['HR_EMPLOYEES:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test.each([
    ['moves', teamId, '660000000000000000000009', 'syncTeamMembership'],
    ['clears', teamId, null, 'deactivateTeamMembership'],
  ])('%s team membership in the profile update transaction', async (_label, currentTeamId, nextTeamId, operation) => {
    const profileId = '660000000000000000000004';
    const session = {
      withTransaction: jest.fn(async (work) => work()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    repository.findById.mockResolvedValue({
      _id: profileId, accountId, departmentId, teamId: currentTeamId,
    });
    organizationPublic.getDepartmentById.mockResolvedValue({ id: departmentId, status: 'ACTIVE' });
    if (nextTeamId) {
      organizationPublic.getTeamById.mockResolvedValue({
        id: nextTeamId, departmentId, status: 'ACTIVE',
      });
    }
    repository.updateById.mockResolvedValue({
      _id: profileId, accountId, departmentId, teamId: nextTeamId,
    });

    await service.updateProfile(profileId, { teamId: nextTeamId }, {
      permissions: ['HR_EMPLOYEES:WRITE'],
    });

    expect(repository.updateById).toHaveBeenCalledWith(
      profileId, expect.objectContaining({ teamId: nextTeamId }), { session },
    );
    if (operation === 'syncTeamMembership') {
      expect(organizationPublic.syncTeamMembership).toHaveBeenCalledWith(
        { accountId, teamId: nextTeamId }, { session },
      );
    } else {
      expect(organizationPublic.deactivateTeamMembership).toHaveBeenCalledWith(accountId, { session });
    }
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('rejects sensitive updates without compensation write permission', async () => {
    await expect(service.createProfile({
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      baseCurrency: 'USD',
      baseSalary: 10000000,
    }, { permissions: ['HR_EMPLOYEES:WRITE'] })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });

  test('allows self completion for personal fields only and audits field names', async () => {
    const profileId = '660000000000000000000004';
    const personalProfile = {
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId,
      teamId,
    };
    const payload = {
      phoneNumber: '0900000000',
      address: 'HCM',
      personalEmail: 'me@example.com',
      emergencyContact: { name: 'A', phone: '0900000001', relation: 'PARENT' },
    };
    repository.findByAccountId.mockResolvedValue(personalProfile);
    repository.updateById.mockResolvedValue({ ...personalProfile, ...payload, isProfileUpdated: true });

    await expect(service.updateMyPersonalProfile(payload, { accountId })).resolves.toMatchObject({
      id: profileId,
      isProfileUpdated: true,
    });
    await expect(service.updateMyPersonalProfile({ ...payload, departmentId }, { accountId }))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(repository.updateById).toHaveBeenCalledWith(profileId, { ...payload, isProfileUpdated: true });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_EMPLOYEE_PROFILE_PERSONAL_COMPLETED',
      metadata: { changedFields: Object.keys(payload).sort() },
    }), {});
  });

  test('identifies the duplicate personal profile field without exposing its value', async () => {
    const profileId = '660000000000000000000004';
    repository.findByAccountId.mockResolvedValue({ _id: profileId, accountId });
    repository.updateById.mockRejectedValue(Object.assign(new Error('duplicate key'), {
      code: 11000,
      keyPattern: { personalEmail: 1 },
      keyValue: { personalEmail: 'private@example.com' },
    }));

    await expect(service.updateMyPersonalProfile({ personalEmail: 'private@example.com' }, { accountId }))
      .rejects.toMatchObject({
        code: 'CONFLICT_ERROR',
        message: 'Personal email is already in use',
        details: { field: 'personalEmail' },
      });
  });

  test('returns persisted self-owned personal values and organization display after self update', async () => {
    const profileId = '660000000000000000000004';
    const personalPayload = {
      gender: 'FEMALE',
      birthDate: '1990-01-01',
      phoneNumber: '0900000000',
      address: 'Ho Chi Minh City',
      personalEmail: 'jane.personal@example.test',
      emergencyContact: { name: 'Emergency Contact', phone: '0900000001', relation: 'PARENT' },
      dependantDetails: [{ name: 'Child Nguyen', dob: '2020-01-01', relation: 'CHILD', gender: 'FEMALE' }],
      identityCard: '012345678',
      taxIdentification: 'TAX-1',
      socialInsuranceNumber: 'BHXH-1',
      bankAccount: { bankName: 'VCB', accountNumber: '123' },
    };
    const profile = {
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      workEmail: 'jane@company.test',
      jobTitle: 'Designer',
      departmentId,
      teamId,
      baseSalary: 10000000,
      ...personalPayload,
    };
    repository.findByAccountId.mockResolvedValue(profile);
    repository.updateById.mockResolvedValue({ ...profile, isProfileUpdated: true });
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId,
      department: { id: departmentId, name: 'Production' },
      team: { id: teamId, name: 'Design A' },
    }]);

    await service.updateMyPersonalProfile(personalPayload, { accountId });
    const result = await service.getMyProfile({ accountId });

    expect(repository.findByAccountId).toHaveBeenLastCalledWith(accountId, {
      includeDeleted: true,
      includeSensitive: true,
    });
    expect(result).toMatchObject({
      employeeCode: 'J2501',
      workEmail: 'jane@company.test',
      jobTitle: 'Designer',
      department: { id: departmentId, name: 'Production' },
      team: { id: teamId, name: 'Design A' },
      ...personalPayload,
    });
    expect(result.baseSalary).toBeUndefined();
    expect(result.allowances).toBeUndefined();
    expect(result.responsibilityAllowance).toBeUndefined();
  });

  test('creates a draft self profile when missing', async () => {
    const draft = {
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'ACC000001',
      fullName: 'jane',
      workEmail: 'jane@example.test',
      isProfileUpdated: false,
    };
    repository.findByAccountId.mockResolvedValue(null);
    repository.create.mockResolvedValue(draft);

    await expect(service.getMyProfile({ accountId, email: 'jane@example.test' })).resolves.toMatchObject({
      employeeCode: 'ACC000001',
      fullName: 'jane',
      isProfileUpdated: false,
    });
    expect(repository.findByAccountId).toHaveBeenCalledWith(accountId, {
      includeDeleted: true,
      includeSensitive: true,
    });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      accountId,
      employeeCode: 'ACC000001',
      fullName: 'jane',
      workEmail: 'jane@example.test',
      isDeleted: false,
      deletedAt: null,
      isProfileUpdated: false,
    }));
  });

  test('restores a deleted draft self profile instead of creating a duplicate', async () => {
    const deleted = {
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'OLD',
      fullName: 'Old Name',
      isDeleted: true,
    };
    repository.findByAccountId.mockResolvedValue(deleted);
    repository.updateById.mockResolvedValue({ ...deleted, isDeleted: false, isProfileUpdated: false });

    await service.getMyProfile({ accountId, email: 'jane@example.test' });

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.updateById).toHaveBeenCalledWith(deleted._id, expect.objectContaining({
      accountId,
      isDeleted: false,
      deletedAt: null,
      isProfileUpdated: false,
    }));
  });

  test('keeps sensitive data out of profile detail unless explicitly requested', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      baseSalary: 10000000,
    });

    const result = await service.getProfile('660000000000000000000004', {
      permissions: ['HR_COMPENSATION:READ', 'HR_EMPLOYEES:READ'],
    });

    expect(repository.findById).toHaveBeenCalledWith('660000000000000000000004', { includeSensitive: false });
    expect(result.baseCurrency).toBeUndefined();
    expect(result.baseSalary).toBeUndefined();
  });

  test('does not audit another employee default detail read', async () => {
    const profileId = '660000000000000000000004';
    repository.findById.mockResolvedValue({
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      birthDate: '1990-01-01',
      phoneNumber: '0900000000',
      address: 'Private address',
      personalEmail: 'jane.private@example.com',
      emergencyContact: { name: 'Private Contact', phoneNumber: '0911111111' },
      contractNumber: 'PRIVATE-CONTRACT',
      departmentId,
      teamId,
    });
    const adminAccountId = '660000000000000000000099';

    await service.getProfile(profileId, {
      accountId: adminAccountId,
      permissions: ['HR_EMPLOYEES:READ'],
    });

    expect(repository.findById).toHaveBeenCalledWith(profileId, { includeSensitive: false });
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('does not audit ordinary self-service or directory profile reads', async () => {
    const profileId = '660000000000000000000004';
    const ownProfile = {
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId,
      teamId,
    };
    repository.findById.mockResolvedValue(ownProfile);
    repository.findByAccountId.mockResolvedValue(ownProfile);
    repository.list.mockResolvedValue({
      items: [ownProfile], pagination: { page: 1, limit: 20, total: 1 },
    });
    const selfAuth = { accountId, permissions: ['HR_EMPLOYEES:READ'] };

    await service.getProfile(profileId, selfAuth);
    await service.getMyProfile(selfAuth);
    await service.listProfiles({}, selfAuth);

    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('rejects a department-scoped reader requesting a profile outside its scope', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId: '660000000000000000000099',
      teamId,
    });

    await expect(service.getProfile('660000000000000000000004', {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:READ'],
      }],
    })).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
  });

  test('allows a schedule-only scoped directory read without PII', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        birthDate: '1990-01-01',
        phoneNumber: '0900000000',
        personalEmail: 'jane@example.com',
        bankAccount: { accountNumber: '123' },
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_SCHEDULE:READ'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: [{ departmentId }],
    }));
    expect(result.items[0]).toMatchObject({ employeeCode: 'J2501', fullName: 'Jane Nguyen' });
    expect(result.items[0]).not.toHaveProperty('birthDate');
    expect(result.items[0]).not.toHaveProperty('phoneNumber');
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('bankAccount');
  });

  test('allows a calendar-only team-scoped directory read without sensitive fields', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        personalEmail: 'jane@example.com',
        bankAccount: { accountNumber: '123' },
        baseSalary: 10000000,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'team',
        scopeId: teamId,
        permissions: ['HR_CALENDAR:READ'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: [{ teamId }],
    }));
    expect(result.items[0]).toMatchObject({ employeeCode: 'J2501', fullName: 'Jane Nguyen' });
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('bankAccount');
    expect(result.items[0]).not.toHaveProperty('baseSalary');
  });

  test('global calendar writer receives the non-sensitive directory with team labels', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        personalEmail: 'jane@example.com',
        baseSalary: 10000000,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId,
      department: { id: departmentId, name: 'Production' },
      team: { id: teamId, name: 'Team A' },
    }]);

    const result = await service.listProfiles({}, { permissions: ['HR_CALENDAR:WRITE'] });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ scopeFilters: [] }));
    expect(result.items[0]).toMatchObject({
      employeeCode: 'J2501',
      team: { id: teamId, name: 'Team A' },
    });
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('baseSalary');
  });

  test('falls back to profile organization ids when the account has no active membership', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });
    organizationPublic.listDepartmentsByIds.mockResolvedValue([{
      id: departmentId,
      name: 'Production',
    }]);
    organizationPublic.listTeamsByIds.mockResolvedValue([{
      id: teamId,
      departmentId,
      name: 'Team A',
    }]);

    const result = await service.listProfiles({}, { permissions: ['HR_EMPLOYEES:READ'] });

    expect(result.items[0]).toMatchObject({
      department: { id: departmentId, name: 'Production' },
      team: { id: teamId, name: 'Team A' },
    });
  });

  test('sets directory edit capability from employee-write scope', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    });

    expect(result.items[0].capabilities).toEqual({ edit: true, delete: true, restore: false });
  });

  test('returns mutually exclusive directory capabilities for active and deleted profiles', async () => {
    const activeId = '660000000000000000000004';
    const deletedId = '660000000000000000000005';
    repository.list.mockResolvedValue({
      items: [
        { _id: activeId, accountId, employeeCode: 'ACTIVE', fullName: 'Active', departmentId, teamId },
        {
          _id: deletedId,
          accountId: '660000000000000000000006',
          employeeCode: 'DELETED',
          fullName: 'Deleted',
          departmentId,
          teamId,
          isDeleted: true,
          deletedAt: new Date('2026-07-28T00:00:00.000Z'),
        },
      ],
      pagination: { page: 1, limit: 20, total: 2 },
    });

    const result = await service.listProfiles({ includeDeleted: true }, {
      permissions: ['HR_EMPLOYEES:WRITE'],
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: activeId,
        isDeleted: false,
        capabilities: { edit: true, delete: true, restore: false },
      }),
      expect.objectContaining({
        id: deletedId,
        isDeleted: true,
        capabilities: { edit: false, delete: false, restore: true },
      }),
    ]));
  });

  test('rejects a scoped writer creating a profile outside its department', async () => {
    const otherDepartmentId = '660000000000000000000099';
    organizationPublic.getDepartmentById.mockResolvedValue({
      _id: otherDepartmentId,
      status: 'ACTIVE',
    });

    await expect(service.createProfile({
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId: otherDepartmentId,
    }, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });

    expect(repository.create).not.toHaveBeenCalled();
  });

  test('rejects moving a profile from an allowed department to an unauthorized team', async () => {
    const otherDepartmentId = '660000000000000000000098';
    const otherTeamId = '660000000000000000000099';
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId,
      teamId,
    });
    organizationPublic.getDepartmentById.mockResolvedValue({
      _id: otherDepartmentId,
      status: 'ACTIVE',
    });
    organizationPublic.getTeamById.mockResolvedValue({
      _id: otherTeamId,
      departmentId: otherDepartmentId,
      status: 'ACTIVE',
    });

    await expect(service.updateProfile('660000000000000000000004', {
      departmentId: otherDepartmentId,
      teamId: otherTeamId,
    }, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });

    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('rejects deleting or restoring a profile outside employee-write scope', async () => {
    const profileId = '660000000000000000000004';
    repository.findById.mockResolvedValue({
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId: '660000000000000000000099',
      teamId: null,
    });
    const scopedWriter = {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    };

    await expect(service.deleteProfile(profileId, scopedWriter))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });
    await expect(service.restoreProfile(profileId, scopedWriter))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });

    expect(repository.softDelete).not.toHaveBeenCalled();
    expect(repository.restore).not.toHaveBeenCalled();
  });

  test('allows an attendance operator to list only its scoped directory projection', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        personalEmail: 'jane@example.com',
        baseSalary: 10000000,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_ATTENDANCE:MANAGE'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: [{ departmentId }],
    }));
    expect(result.items[0]).toMatchObject({ employeeCode: 'J2501', fullName: 'Jane Nguyen' });
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('baseSalary');
  });
});
