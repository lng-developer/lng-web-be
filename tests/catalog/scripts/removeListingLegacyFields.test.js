const { LEGACY_FIELDS, isLegacyIndex } = require('../../../tools/scripts/maintenance/removeListingLegacyFields');

describe('removeListingLegacyFields', () => {
  test('targets only indexes containing a removed Listing field', () => {
    expect(LEGACY_FIELDS).toEqual([
      'productTypeGroupId',
      'internalTemplateId',
      'psdTemplateAssetId',
      'previewAssetId',
      'psdStatus',
      'costCenterStatus',
    ]);
    expect(isLegacyIndex({ key: { productTypeGroupId: 1, status: 1 } })).toBe(true);
    expect(isLegacyIndex({ key: { shopId: 1, asin: 1 } })).toBe(false);
  });
});
