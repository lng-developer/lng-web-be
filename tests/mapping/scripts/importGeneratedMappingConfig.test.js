const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildImportPayloads,
} = require('../../../src/modules/mapping/scripts/importGeneratedMappingConfig');

describe('importGeneratedMappingConfig script helpers', () => {
  test('buildImportPayloads reads clean generated files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapping-import-'));

    fs.writeFileSync(path.join(dir, 'normalization-rules.importable.json'), JSON.stringify([
      {
        semanticRole: 'SIZE',
        matchTarget: 'LABEL',
        matchType: 'EXACT',
        matchValue: 'Select Size',
        priority: 30,
        status: 'ACTIVE',
      },
    ]));
    fs.writeFileSync(path.join(dir, 'sku-normalize-rules.suggested.json'), JSON.stringify([
      {
        patternType: 'SEGMENT',
        segmentIndex: 1,
        segmentRole: 'SIZE',
        appliesWhenValues: ['S', 'M'],
        outputAction: 'REMOVE_SEGMENT',
        priority: 50,
        status: 'ACTIVE',
      },
    ]));
    fs.writeFileSync(
      path.join(dir, 'sku-config-rules.importable.csv'),
      [
        'configCode,salesChannelCode,marketplaceCode,countryCode,currentProductTypeGroupId,productTypeAliases,platformProductType,status',
        'TS1S,AMAZON,AMAZON_US,US,689950b5376deb55899dba26,UNISEX T-SHIRT | COMFORT COLOR T-SHIRT,,ACTIVE',
      ].join('\n'),
    );

    const payloads = buildImportPayloads(dir);

    expect(payloads.normalizationRules).toHaveLength(1);
    expect(payloads.skuNormalizeRules[0]).toMatchObject({
      patternType: 'SEGMENT',
      segmentIndex: 1,
      appliesWhenValues: ['S', 'M'],
    });
    expect(payloads.skuConfigRules[0]).toMatchObject({
      configCode: 'TS1S',
      productTypeGroupId: '689950b5376deb55899dba26',
      productTypeAliases: ['UNISEX T-SHIRT', 'COMFORT COLOR T-SHIRT'],
    });
  });
});
