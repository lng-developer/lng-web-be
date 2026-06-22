const {
  accountProfileSchema,
  validate,
} = require('../../../modules/auth/validators/auth.validator');

describe('auth validators', () => {
  test('accountProfileSchema strips unsupported HRM fields', () => {
    const { value, details } = validate(accountProfileSchema, {
      fullName: 'Admin',
      phone: '+84901234567',
      salary: 100000,
      departmentId: '507f1f77bcf86cd799439011',
      contractNumber: 'HD-001',
    });

    expect(details).toBeNull();
    expect(value).toEqual({
      fullName: 'Admin',
      phone: '+84901234567',
    });
  });
});
