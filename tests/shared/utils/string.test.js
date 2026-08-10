const { normalizeLowercase, normalizeUppercase } = require('../../../src/shared/utils/string');

describe('string utils', () => {
  test('normalizeUppercase trims and uppercases values', () => {
    expect(normalizeUppercase(' orders:read ')).toBe('ORDERS:READ');
  });

  test('normalizeLowercase trims and lowercases values', () => {
    expect(normalizeLowercase(' Admin@Example.com ')).toBe('admin@example.com');
  });
});
