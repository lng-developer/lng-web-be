const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const loader = path.resolve(__dirname, '../src/config/loadEnv.js');
let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lng-env-'));
  fs.writeFileSync(path.join(cwd, '.env'), 'ENV_SELECTION_PROBE=legacy');
  fs.writeFileSync(path.join(cwd, '.env.development'), 'ENV_SELECTION_PROBE=dev');
  fs.writeFileSync(path.join(cwd, '.env.production'), 'ENV_SELECTION_PROBE=prod');
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

function read(env = {}) {
  return execFileSync(process.execPath, ['-r', loader, '-e',
    'process.stdout.write(process.env.ENV_SELECTION_PROBE || "none")'], {
    cwd, encoding: 'utf8', env: { ...process.env, APP_ENV: '', NODE_ENV: '', ...env },
  });
}

test('defaults to development without reading the legacy file', () => expect(read()).toBe('dev'));
test('selects production by NODE_ENV', () => expect(read({ NODE_ENV: 'production' })).toBe('prod'));
test('staging can use development config with production runtime', () => {
  expect(read({ APP_ENV: 'development', NODE_ENV: 'production' })).toBe('dev');
});
test('process environment takes precedence', () => {
  expect(read({ ENV_SELECTION_PROBE: 'injected' })).toBe('injected');
});
test('tests never read application files', () => expect(read({ NODE_ENV: 'test' })).toBe('none'));
test('Jest setup overrides an inherited development selector', () => {
  const output = execFileSync(process.execPath, ['-r', path.resolve(__dirname, 'setup.js'),
    '-r', loader, '-e', 'process.stdout.write(process.env.ENV_SELECTION_PROBE || "none")'], {
    cwd, encoding: 'utf8', env: { ...process.env, APP_ENV: 'development', NODE_ENV: 'test' },
  });
  expect(output).toBe('none');
});
test.each(['missing', 'invalid'])('fails closed for %s environment configuration', (kind) => {
  if (kind === 'missing') fs.unlinkSync(path.join(cwd, '.env.production'));
  const result = spawnSync(process.execPath, ['-r', loader, '-e', ''], {
    cwd, env: { ...process.env, APP_ENV: kind === 'missing' ? 'production' : 'typo' },
  });
  expect(result.status).not.toBe(0);
});
