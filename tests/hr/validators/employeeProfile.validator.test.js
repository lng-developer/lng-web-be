const {
  createProfileSchema,
  updateProfileSchema,
  validate,
} = require('../../../src/modules/hr/validators/employeeProfile.validator');

describe('employee profile validator', () => {
  test('normalizes employee code and rejects invalid ISO dates', () => {
    const { value, details } = validate(createProfileSchema, {
      accountId: '660000000000000000000001',
      employeeCode: ' j2501 ',
      fullName: 'Jane Nguyen',
      gender: 'female',
      contractNumber: 'HD-01',
      startDate: 'not-a-date',
    });

    expect(value.employeeCode).toBe('J2501');
    expect(value.gender).toBe('FEMALE');
    expect(value.contractNumber).toBe('HD-01');
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['startDate'], type: 'date.format' }),
    ]));
  });

  test('drops avatar fields because avatars can only change through file upload', () => {
    const { value, details } = validate(updateProfileSchema, {
      avatarAssetId: '660000000000000000000009',
      avatarUrl: 'default-avatar.jpg',
      jobTitle: 'Lead',
    });

    expect(details).toBeUndefined();
    expect(value).toEqual({ jobTitle: 'Lead' });
  });

  test.each([
    [{ startDate: '2026-07-10', probationEndDate: '2026-07-09' }, 'probationEndDate'],
    [{ startDate: '2026-07-10', endDate: '2026-07-09' }, 'endDate'],
    [{ contractStartDate: '2026-07-10', contractEndDate: '2026-07-09' }, 'contractEndDate'],
  ])('rejects reversed date range %#', (payload, field) => {
    const { details } = validate(updateProfileSchema, payload);

    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: [field] }),
    ]));
  });
});
