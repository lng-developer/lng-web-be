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
        env: {
          ...process.env,
          MONGODB_URI: 'mongodb://127.0.0.1:27017/lng_web_be_test',
        },
      },
    );

    if (result.status !== 0) {
      throw new Error(
        [
          `seedOrganizationDemo exited with status ${result.status}`,
          `stdout:\n${result.stdout}`,
          `stderr:\n${result.stderr}`,
        ].join('\n'),
      );
    }
  });
});
