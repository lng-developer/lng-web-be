const { isDuplicateKeyError } = require('../../../src/shared/utils/mongo');

describe('mongo utils', () => {
  test('isDuplicateKeyError detects Mongo duplicate key errors', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ code: 12345 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
  });
});
