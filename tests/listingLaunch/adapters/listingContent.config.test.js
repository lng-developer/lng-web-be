jest.mock('dotenv', () => ({ config: jest.fn() }));

const originalEnv = process.env;
beforeEach(() => {
  jest.resetModules();
  process.env = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/isolated_config_test' };
});
afterEach(() => { process.env = originalEnv; });

test('generation defaults to disabled with no inferred model or key', () => {
  expect(require('../../../src/config').listingContent).toEqual({ enabled: false, model: null, apiKey: null, timeoutMs: 90000 });
});
test('reads only configured model and server-side key', () => {
  Object.assign(process.env, { LISTING_CONTENT_ENABLED: 'true', LISTING_CONTENT_MODEL: ' chosen-model ', OPENAI_API_KEY: ' mock-only-key ' });
  expect(require('../../../src/config').listingContent).toEqual({ enabled: true, model: 'chosen-model', apiKey: 'mock-only-key', timeoutMs: 90000 });
});
test('missing credentials do not prevent startup while readiness can reject generation', () => {
  process.env.LISTING_CONTENT_ENABLED = 'true';
  expect(require('../../../src/config').listingContent).toMatchObject({ enabled: true, model: null, apiKey: null });
});
