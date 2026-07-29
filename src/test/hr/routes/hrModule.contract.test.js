const fs = require('fs');
const path = require('path');

function loadHrModule() {
  let hr;
  jest.isolateModules(() => {
    hr = require('../../../modules/hr');
  });
  return hr;
}

describe('hr module', () => {
  test('registers the HR router', () => {
    expect(loadHrModule()).toEqual(expect.objectContaining({
      router: expect.any(Function),
      public: expect.any(Object),
    }));
  });

  test('mounts the HR router under /api/hr', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../modules/index.js'), 'utf8');

    expect(source).toContain("router.use('/hr', hr.router);");
  });

  test('declares the staff provisioning and self-onboarding public routes', () => {
    const hrRoutes = fs.readFileSync(path.join(__dirname, '../../../modules/hr/routes/index.js'), 'utf8');
    const authRoutes = fs.readFileSync(path.join(__dirname, '../../../modules/auth/routes/index.js'), 'utf8');
    const setupGate = fs.readFileSync(
      path.join(__dirname, '../../../modules/auth/middlewares/requireAccountSetupComplete.js'),
      'utf8',
    );

    expect(hrRoutes).toMatch(/router\.post\(\s*'\/staff-provisioning',\s*authPublic\.authenticate,\s*requireEmployeeWrite,/);
    expect(hrRoutes).toMatch(/router\.get\(\s*'\/staff-provisioning\/roles',\s*authPublic\.authenticate,\s*requireEmployeeWrite,/);
    expect(hrRoutes).toMatch(/router\.patch\(\s*'\/employee-profiles\/me\/personal',\s*authPublic\.authenticate,\s*asyncHandler\(employeeProfileController\.updateMyPersonalProfile\),/);
    expect(authRoutes).toMatch(/router\.post\('\/me\/change-password', authenticate, asyncHandler\(authController\.changeOwnPassword\)\);/);
    expect(setupGate).toContain("'POST /api/auth/me/change-password'");
    expect(setupGate).toContain("'PATCH /api/hr/employee-profiles/me/personal'");
    expect(setupGate).toContain('errorCodes.ACCOUNT_SETUP_REQUIRED');
  });
});
