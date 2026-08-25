const path = require('path');
const { spawnSync } = require('child_process');

test('server entrypoint parses', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', 'src', 'server.js')], {
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});
