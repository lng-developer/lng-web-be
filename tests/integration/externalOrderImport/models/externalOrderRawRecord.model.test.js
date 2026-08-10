const ExternalOrderRawRecord = require('../../../../src/modules/integration/externalOrderImport/models/externalOrderRawRecord.model');

describe('ExternalOrderRawRecord model', () => {
  test('expires raw records 90 days after creation', () => {
    expect(ExternalOrderRawRecord.schema.indexes()).toContainEqual([
      { createdAt: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60 },
    ]);
  });
});
