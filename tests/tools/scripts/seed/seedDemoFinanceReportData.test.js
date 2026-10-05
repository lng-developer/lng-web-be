const {
  DEMO_DATABASE_NAME,
  assertDemoSeedAllowed,
  databaseNameFromUri,
  parseCliArguments,
} = require('../../../../tools/scripts/seed/seedDemoFinanceReportData');

describe('demo finance report seed guard', () => {
  test('accepts only the isolated demo database with explicit non-production opt-in', () => {
    expect(() => assertDemoSeedAllowed(
      { NODE_ENV: 'development', ALLOW_ANALYTICS_DEMO_SEED: 'true' },
      'mongodb://user:secret@localhost:27017/lng_web_be_demo?retryWrites=true',
    )).not.toThrow();

    expect(DEMO_DATABASE_NAME).toBe('lng_web_be_demo');
  });

  test.each([
    ['production', { NODE_ENV: 'production', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/lng_web_be_demo', 'disabled in production'],
    ['missing opt-in', { NODE_ENV: 'test' }, 'mongodb://localhost/lng_web_be_demo', 'ALLOW_ANALYTICS_DEMO_SEED=true'],
    ['primary database', { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/lng_web_be', 'lng_web_be_demo'],
    ['similarly named database', { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/lng_web_be_demo_backup', 'lng_web_be_demo'],
    ['database-less URI', { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' }, 'mongodb://localhost/?retryWrites=true', 'lng_web_be_demo'],
  ])('rejects %s without exposing the URI', (_name, env, uri, message) => {
    expect(() => assertDemoSeedAllowed(env, uri)).toThrow(message);
    expect(() => assertDemoSeedAllowed(env, uri)).not.toThrow('secret');
  });

  test('extracts only the decoded database path', () => {
    expect(databaseNameFromUri('mongodb+srv://user:pass@cluster.example/lng_web_be_demo?retryWrites=true')).toBe('lng_web_be_demo');
    expect(databaseNameFromUri('mongodb://localhost/')).toBeNull();
  });

  test('defaults to dry-run and requires apply before reset can mutate', () => {
    expect(parseCliArguments([])).toEqual({ apply: false, reset: false });
    expect(parseCliArguments(['--reset'])).toEqual({ apply: false, reset: true });
    expect(parseCliArguments(['--apply', '--reset'])).toEqual({ apply: true, reset: true });
  });
});
