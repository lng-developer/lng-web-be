const UserProfile = require('../../../modules/auth/models/userProfile.model');

describe('UserProfile model', () => {
  test('omits employeeCode when it is not provided', () => {
    const profile = new UserProfile({
      accountId: '507f1f77bcf86cd799439011',
      email: 'test01@lng.co',
      fullName: 'Test User',
    });

    expect(profile.toObject()).not.toHaveProperty('employeeCode');
  });

  test('accepts optional personal profile metadata', async () => {
    const profile = new UserProfile({
      accountId: '507f1f77bcf86cd799439011',
      email: 'test01@lng.co',
      fullName: 'Test User',
      phone: '+84901234567',
      avatarUrl: 'https://example.com/avatar.png',
      personalEmail: 'personal@example.com',
      dateOfBirth: new Date('1995-01-02T00:00:00.000Z'),
      gender: 'female',
      address: 'Ho Chi Minh City',
    });

    await expect(profile.validate()).resolves.toBeUndefined();
    expect(profile.phone).toBe('+84901234567');
    expect(profile.personalEmail).toBe('personal@example.com');
    expect(profile.gender).toBe('female');
  });
});
