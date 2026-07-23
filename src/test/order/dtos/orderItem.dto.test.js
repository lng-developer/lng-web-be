const { toOrderItemDto } = require('../../../modules/order/dtos/orderItem.dto');

describe('orderItem.dto', () => {
  test('standard item DTO excludes raw variant, customization, and external snapshots', () => {
    const dto = toOrderItemDto({
      _id: '660000000000000000000401',
      orderId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      variantRaw: { Color: 'Sand' },
      customizationRawSummary: {
        customizationUrl: 'https://secret.example.test/customization',
      },
      externalData: {
        amazon: { token: 'secret-token' },
      },
    });

    expect(dto).not.toHaveProperty('variantRaw');
    expect(dto).not.toHaveProperty('customizationRawSummary');
    expect(dto).not.toHaveProperty('externalData');
    expect(JSON.stringify(dto)).not.toContain('secret');
  });
});
