const CustomizationPayload = require('../../../src/modules/customization/models/customizationPayload.model');

function countIndex(model, expectedFields) {
  return model.schema.indexes()
    .filter(([fields]) => JSON.stringify(fields) === JSON.stringify(expectedFields))
    .length;
}

describe('CustomizationPayload model', () => {
  test('does not declare duplicate raw record index', () => {
    expect(countIndex(CustomizationPayload, { rawRecordId: 1 })).toBe(1);
  });

  test('supports latest payload lookup by order item', () => {
    expect(countIndex(CustomizationPayload, { orderItemId: 1, createdAt: -1, _id: -1 })).toBe(1);
  });
});
