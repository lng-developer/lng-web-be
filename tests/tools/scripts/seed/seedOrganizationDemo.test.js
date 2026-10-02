const path = require('path');
const { spawnSync } = require('child_process');

describe('seedOrganizationDemo', () => {
  test('loads the scope and membership maintenance dependencies', () => {
    const result = spawnSync(
      process.execPath,
      ['-e', "require('./tools/scripts/seed/seedOrganizationDemo')"],
      {
        cwd: path.resolve(__dirname, '../../../..'),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
  });
});
