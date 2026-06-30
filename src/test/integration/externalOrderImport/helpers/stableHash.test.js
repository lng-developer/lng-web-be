const {
  calculateFileHash,
  calculateRecordHash,
} = require('../../../../modules/integration/externalOrderImport/helpers/stableHash');

describe('stableHash', () => {
  test('top-level key order does not affect record hash', () => {
    expect(calculateRecordHash({ b: 2, a: 1 })).toBe(calculateRecordHash({ a: 1, b: 2 }));
  });

  test('nested key order does not affect record hash', () => {
    expect(calculateRecordHash({ a: { z: 1, y: 2 } })).toBe(calculateRecordHash({ a: { y: 2, z: 1 } }));
  });

  test('array order affects record hash', () => {
    expect(calculateRecordHash({ a: [1, 2] })).not.toBe(calculateRecordHash({ a: [2, 1] }));
  });

  test('repeated calls return same file hash', () => {
    expect(calculateFileHash('hello')).toBe(calculateFileHash(Buffer.from('hello')));
  });
});
