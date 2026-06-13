const { assertValidObjectId, isValidObjectId } = require('../../../shared/utils/objectId');

describe('objectId utils', () => {
  test('isValidObjectId validates Mongo ObjectId strings', () => {
    expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
    expect(isValidObjectId('invalid-id')).toBe(false);
  });

  test('assertValidObjectId throws operational validation errors', () => {
    expect(() => assertValidObjectId('invalid-id', 'accountId')).toThrow('accountId is invalid');
  });
});
