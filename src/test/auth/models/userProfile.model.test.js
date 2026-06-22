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
});
