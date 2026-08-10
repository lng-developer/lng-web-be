const {
  toEmployeeProfileDto,
  toEmployeePersonalProfileDto,
  toEmployeeProfileDirectoryDto,
} = require('../../../src/modules/hr/dtos/employeeProfile.dto');

describe('employeeProfile DTO', () => {
  const profile = {
    _id: 'profile-1',
    accountId: 'account-1',
    employeeCode: 'J2501',
    fullName: 'Jane Nguyen',
    baseSalary: 10000000,
    bankAccount: { bankName: 'VCB', accountNumber: '123' },
    identityCard: '012345678',
    taxIdentification: 'TAX-1',
    socialInsuranceNumber: 'BHXH-1',
  };

  test('omits sensitive fields by default', () => {
    const dto = toEmployeeProfileDto(profile);

    expect(dto.baseSalary).toBeUndefined();
    expect(dto.bankAccount).toBeUndefined();
    expect(dto.identityCard).toBeUndefined();
    expect(dto.taxIdentification).toBeUndefined();
    expect(dto.socialInsuranceNumber).toBeUndefined();
  });

  test('includes sensitive fields when explicitly authorized', () => {
    const dto = toEmployeeProfileDto({
      ...profile,
      allowances: { lunch: 30000, fuel: 0, other: 0 },
    }, { includeSensitive: true });

    expect(dto.baseSalary).toBe(10000000);
    expect(dto.bankAccount).toEqual({ bankName: 'VCB', accountNumber: '123' });
    expect(dto.allowances).toEqual({ lunch: 30000, fuel: 0, other: 0 });
  });

  test('includes self-owned personal fields but never compensation', () => {
    const dto = toEmployeePersonalProfileDto(profile, {
      includeSensitive: true,
      capabilities: { edit: true, delete: true, restore: false },
    });

    expect(dto.identityCard).toBe('012345678');
    expect(dto.taxIdentification).toBe('TAX-1');
    expect(dto.socialInsuranceNumber).toBe('BHXH-1');
    expect(dto.bankAccount).toEqual({ bankName: 'VCB', accountNumber: '123' });
    expect(dto.baseSalary).toBeUndefined();
    expect(dto.accountId).toBeUndefined();
    expect(dto.capabilities).toBeUndefined();
  });

  test('keeps account identifiers out of directory selector rows', () => {
    const dto = toEmployeeProfileDirectoryDto(profile);

    expect(dto).toMatchObject({ id: 'profile-1', fullName: 'Jane Nguyen' });
    expect(dto.accountId).toBeUndefined();
  });

  test('maps incomplete self-profile setup status in directory rows', () => {
    const dto = toEmployeeProfileDirectoryDto({ ...profile, isProfileUpdated: false });

    expect(dto.onboardingStatus).toBe('PROFILE_INCOMPLETE');
  });

  test('maps completed self-profile setup status in profile details', () => {
    const dto = toEmployeeProfileDto({ ...profile, isProfileUpdated: true });

    expect(dto.onboardingStatus).toBe('READY');
  });

  test('exposes the HR avatar endpoint for Media-backed avatars', () => {
    const dto = toEmployeeProfileDto({
      ...profile,
      avatarAssetId: '660000000000000000000009',
    });

    expect(dto.avatarAssetId).toBe('660000000000000000000009');
    expect(dto.avatarUrl).toBe('/api/hr/employee-profiles/profile-1/avatar');
  });

  test('exposes the self-service avatar endpoint in the personal profile', () => {
    const dto = toEmployeePersonalProfileDto({
      ...profile,
      avatarAssetId: '660000000000000000000009',
    });

    expect(dto.avatarUrl).toBe('/api/hr/employee-profiles/me/avatar');
  });
});
