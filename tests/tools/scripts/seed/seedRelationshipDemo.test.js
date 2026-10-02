const mockStopAfterOrganizationSeed = new Error('stop after organization seed');

jest.mock('../../../../src/modules/auth/scripts/seedRbac', () => ({
  seedRbac: jest.fn(),
}));
jest.mock('../../../../src/modules/auth/scripts/seedDemoUsers', () => ({
  seedDemoUsers: jest.fn(),
  DEMO_PASSWORD: 'test-password',
  scopedPermissionRules: [],
}));
jest.mock('../../../../tools/scripts/seed/seedHrDemoProfiles', () => ({
  run: jest.fn(),
}));
jest.mock('../../../../tools/scripts/seed/seedOrganizationDemo', () => ({
  seedOrganizationDemo: jest.fn(async () => {
    throw mockStopAfterOrganizationSeed;
  }),
}));
jest.mock('../../../../tools/scripts/seed/seedShopDemo', () => ({
  seedShopDemo: jest.fn(),
  demoShops: [],
}));

const { seedDemoUsers } = require('../../../../src/modules/auth/scripts/seedDemoUsers');
const { run: seedHrDemoProfilesWithConnection } = require('../../../../tools/scripts/seed/seedHrDemoProfiles');
const { seedOrganizationDemo } = require('../../../../tools/scripts/seed/seedOrganizationDemo');
const { seedRelationshipDemo } = require('../../../../tools/scripts/seed/seedRelationshipDemo');

describe('seedRelationshipDemo', () => {
  test('creates HR demo profiles before organization memberships', async () => {
    await expect(seedRelationshipDemo()).rejects.toBe(mockStopAfterOrganizationSeed);

    expect(seedDemoUsers).toHaveBeenCalledTimes(1);
    expect(seedHrDemoProfilesWithConnection).toHaveBeenCalledTimes(1);
    expect(seedOrganizationDemo).toHaveBeenCalledTimes(1);
    expect(seedHrDemoProfilesWithConnection.mock.invocationCallOrder[0])
      .toBeLessThan(seedOrganizationDemo.mock.invocationCallOrder[0]);
  });
});
