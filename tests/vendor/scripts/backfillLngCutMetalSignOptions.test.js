const { optionsFromCode } = require('../../../src/modules/vendor/scripts/backfillLngCutMetalSignOptions');

describe('backfillLngCutMetalSignOptions', () => {
  test('maps one-sided and two-sided CMS SKUs to the same size', () => {
    expect(optionsFromCode('PRODUCT_CMS_LNGCMS12')).toEqual({
      vendorSize: '12', standardSize: '12', printMethod: 'ONE_SIDED',
    });
    expect(optionsFromCode('PRODUCT_CMS_LNGCMS12_2SIDES')).toEqual({
      vendorSize: '12', standardSize: '12', printMethod: 'TWO_SIDED',
    });
  });

  test('ignores unrelated cost-center codes', () => {
    expect(optionsFromCode('PRODUCT_PMS_LNGPMSXL')).toBeNull();
  });
});
