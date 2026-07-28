const {
  accountCreateSchema,
  loginSchema,
  validate,
} = require('../../../modules/auth/validators/auth.validator');

describe('auth validators', () => {
  test('loginSchema accepts an employee code identifier', () => {
    const { value, details } = validate(loginSchema, {
      identifier: ' j2501 ',
      password: 'secret',
    });

    expect(details).toBeNull();
    expect(value).toEqual({ identifier: 'j2501', password: 'secret' });
  });

  test('loginSchema keeps legacy email payloads compatible', () => {
    const { value, details } = validate(loginSchema, {
      email: 'admin@lng.co',
      password: 'secret',
    });

    expect(details).toBeNull();
    expect(value).toEqual({ email: 'admin@lng.co', password: 'secret' });
  });

  test.each([
    { password: 'secret' },
    { identifier: 'J2501', email: 'admin@lng.co', password: 'secret' },
  ])('loginSchema requires exactly one login identifier', (payload) => {
    expect(validate(loginSchema, payload).details).not.toBeNull();
  });

  test('accountCreateSchema strips profile fields', () => {
    const { value, details } = validate(accountCreateSchema, {
      email: 'admin@lng.co',
      password: 'Password@123',
      assignments: [{
        roleId: '507f1f77bcf86cd799439011',
        scopeType: 'global',
        scopeId: null,
      }],
      fullName: 'Admin',
      personalEmail: 'admin@example.com',
    });

    expect(details).toBeNull();
    expect(value).toMatchObject({ email: 'admin@lng.co', password: 'Password@123' });
    expect(value).not.toHaveProperty('fullName');
    expect(value).not.toHaveProperty('personalEmail');
  });
});
