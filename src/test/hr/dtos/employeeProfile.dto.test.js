const { toEmployeeProfileDto, toEmployeeProfileDirectoryDto } = require('../../../modules/hr/dtos/employeeProfile.dto');

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

  test('keeps account identifiers out of directory selector rows', () => {
    const dto = toEmployeeProfileDirectoryDto(profile);

    expect(dto).toMatchObject({ id: 'profile-1', fullName: 'Jane Nguyen' });
    expect(dto.accountId).toBeUndefined();
  });
});
