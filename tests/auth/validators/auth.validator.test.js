const {
  accountCreateSchema,
  loginSchema,
  googleLoginSchema,
  microsoftLoginSchema,
  validate,
} = require('../../../src/modules/auth/validators/auth.validator');

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

  test('googleLoginSchema validates idToken successfully', () => {
    const { value, details } = validate(googleLoginSchema, {
      idToken: ' some-valid-token ',
    });

    expect(details).toBeNull();
    expect(value).toEqual({ idToken: 'some-valid-token' });
  });

  test('googleLoginSchema validates accessToken successfully', () => {
    const { value, details } = validate(googleLoginSchema, {
      accessToken: ' some-access-token ',
    });

    expect(details).toBeNull();
    expect(value).toEqual({ accessToken: 'some-access-token' });
  });

  test('googleLoginSchema rejects missing or both tokens', () => {
    expect(validate(googleLoginSchema, {}).details).not.toBeNull();
    expect(validate(googleLoginSchema, { idToken: '', accessToken: '' }).details).not.toBeNull();
    expect(validate(googleLoginSchema, { idToken: 'a', accessToken: 'b' }).details).not.toBeNull();
  });

  test('microsoftLoginSchema validates idToken successfully', () => {
    const { value, details } = validate(microsoftLoginSchema, {
      idToken: ' some-microsoft-id-token ',
    });

    expect(details).toBeNull();
    expect(value).toEqual({ idToken: 'some-microsoft-id-token' });
  });

  test('microsoftLoginSchema rejects missing or empty idToken', () => {
    expect(validate(microsoftLoginSchema, {}).details).not.toBeNull();
    expect(validate(microsoftLoginSchema, { idToken: '' }).details).not.toBeNull();
  });
});
