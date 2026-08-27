const {
  retryPostImportSchema,
  validate,
} = require('../../../../src/modules/integration/externalOrderImport/validators/externalOrderImport.validator');

test('rejects retry batches larger than 25 records', () => {
  const rawRecordIds = Array.from({ length: 26 }, (_, index) => `660000000000000000${String(index).padStart(6, '0')}`);

  expect(validate(retryPostImportSchema, { rawRecordIds }).details).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: ['rawRecordIds'], type: 'array.max' }),
  ]));
});
