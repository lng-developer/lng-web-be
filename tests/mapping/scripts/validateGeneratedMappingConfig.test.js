const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseCsv,
  validateGeneratedConfigDirectory,
} = require('../../../src/modules/mapping/scripts/validateGeneratedMappingConfig');

describe('validateGeneratedMappingConfig script helpers', () => {
  test('parseCsv handles quoted comma cells', () => {
    expect(parseCsv('name,note\nTS1S,"Comfort, Color"\n')).toEqual([
      { name: 'TS1S', note: 'Comfort, Color' },
    ]);
  });

  test('reports unmapped generated config rows without writing DB', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapping-config-'));

    fs.writeFileSync(path.join(dir, 'normalization-rules.importable.json'), JSON.stringify([
      {
        semanticRole: 'SIZE',
        matchTarget: 'LABEL',
        matchType: 'EXACT',
        matchValue: 'Select Size',
      },
    ]));
    fs.writeFileSync(
      path.join(dir, 'sku-config-rules.review.csv'),
      [
        'action,configCode,currentProductTypeGroupId,legacyProductTypeGroupName,productTypeAliases',
        'MAP_REQUIRED,TS1S,,Unisex T-shirt,UNISEX T-SHIRT',
        'VERIFY,TS2S,689950b5376deb55899dba26,Premium Sweatshirt,PREMIUM SWEATSHIRT',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'product-type-alias-clean.json'), JSON.stringify([
      { canonicalProductType: 'UNISEX T-SHIRT', totalCount: 10, productTypeGroupId: null },
    ]));

    const report = validateGeneratedConfigDirectory(dir);

    expect(report.ok).toBe(true);
    expect(report.counts).toMatchObject({
      normalizationRules: 1,
      skuConfigRows: 2,
      skuConfigRowsReady: 1,
      skuConfigRowsNeedMapping: 1,
      productTypeAliasGroupsNeedMapping: 1,
    });
    expect(report.samples.skuConfigRowsNeedMapping[0]).toMatchObject({
      configCode: 'TS1S',
      legacyProductTypeGroupName: 'Unisex T-shirt',
    });
  });
});
