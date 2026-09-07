const { assertCloneTarget, parseIndexCollections } = require('../../tools/scripts/maintenance/cloneMongoDatabase');

describe('cloneMongoDatabase safety guard', () => {
  test('only allows a distinct test database as the clone target', () => {
    expect(() => assertCloneTarget('lng_web_be', 'lng_web_be')).toThrow('must differ');
    expect(() => assertCloneTarget('lng_web_be', 'lng_web_be_backup')).toThrow('must end with _test');
    expect(assertCloneTarget('lng_web_be', 'lng_web_be_test')).toBe(true);
  });

  test('parses a bounded set of collections whose indexes will be recreated', () => {
    expect(parseIndexCollections(' listings, listingvariants ,,orderitems ')).toEqual(new Set([
      'listings',
      'listingvariants',
      'orderitems',
    ]));
    expect(parseIndexCollections(null)).toBeNull();
  });
});
