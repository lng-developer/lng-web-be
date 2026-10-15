const requireAccountSetupComplete = require('../../../src/modules/auth/middlewares/requireAccountSetupComplete');

function createRequest({ profileSetupRequired = false, mustChangePassword = false } = {}) {
  return {
    method: 'POST',
    baseUrl: '/api/catalog',
    path: '/listings/listing-1/request-psd',
    auth: {
      profileSetupRequired,
      mustChangePassword,
    },
  };
}

describe('requireAccountSetupComplete', () => {
  test('blocks workspace APIs until a Microsoft account has an LNG password', () => {
    const req = createRequest();
    req.auth.passwordSetupRequired = true;
    const next = jest.fn();
    requireAccountSetupComplete(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_SETUP_REQUIRED' }));
  });

  test('permits the initial-password endpoint during onboarding', () => {
    const req = createRequest({ mustChangePassword: true });
    req.baseUrl = '/api/auth'; req.path = '/me/initial-password';
    const next = jest.fn();
    requireAccountSetupComplete(req, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
  test('does not block business APIs solely because the profile is incomplete', () => {
    const next = jest.fn();

    requireAccountSetupComplete(createRequest({ profileSetupRequired: true }), {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('continues to block business APIs when a password change is required', () => {
    const next = jest.fn();

    requireAccountSetupComplete(createRequest({ mustChangePassword: true }), {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'ACCOUNT_SETUP_REQUIRED',
    }));
  });
});
