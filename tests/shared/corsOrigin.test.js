const { createCorsOrigin } = require('../../src/config/corsOrigin');

function check(origin, env = 'development') {
  return new Promise((resolve) => {
    createCorsOrigin({ env, allowedOrigins: ['https://app.lng.co'] })(origin, (error, allowed) => {
      resolve({ error, allowed });
    });
  });
}

describe('CORS origin policy', () => {
  test.each(['http://localhost:5173', 'http://localhost:5179', 'http://127.0.0.1:4173'])(
    'allows local development origin %s',
    async (origin) => expect(await check(origin)).toEqual({ error: null, allowed: true }),
  );

  test('rejects lookalike domains', async () => {
    const result = await check('http://localhost.evil.example:5173');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  test('keeps production on the explicit allowlist', async () => {
    expect((await check('http://localhost:5173', 'production')).allowed).toBe(false);
    expect(await check('https://app.lng.co', 'production')).toEqual({ error: null, allowed: true });
  });
});
