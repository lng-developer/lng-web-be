const {
  assertMatchingTrackingIdentity,
  deriveTrackingIdentity,
} = require('../../../src/modules/shipment/services/shipmentIdentity.service');

describe('shipmentIdentity.service', () => {
  const identity = {
    id: '660000000000000000130002',
    orderId: '660000000000000000130003',
    orderItemId: '660000000000000000130004',
    shopId: '660000000000000000130005',
    provider: 'MERCHIZE',
    vendorExternalOrderId: 'MZ-100',
    payloadSnapshot: {
      vendorProduct: {
        vendor: {
          id: '660000000000000000130009',
          providerKey: 'MERCHIZE',
        },
      },
    },
  };

  test('derives immutable tracking identity from the submission snapshot', () => {
    expect(deriveTrackingIdentity(identity)).toEqual({
      vendorId: '660000000000000000130009',
      provider: 'MERCHIZE',
      vendorExternalOrderId: 'MZ-100',
      shopId: '660000000000000000130005',
      orderId: '660000000000000000130003',
      orderItemId: '660000000000000000130004',
    });
  });

  test('rejects compatibility fields that do not match persisted identity', () => {
    const derived = deriveTrackingIdentity(identity);
    expect(() => assertMatchingTrackingIdentity(derived, { provider: 'PRINTWAY' }))
      .toThrow(/provider does not match/i);
    expect(() => assertMatchingTrackingIdentity(derived, { externalOrderId: 'OTHER-100' }))
      .toThrow(/external order id does not match/i);
  });

  test('rejects incomplete snapshot identity', () => {
    expect(() => deriveTrackingIdentity({ ...identity, payloadSnapshot: {} }))
      .toThrow(/identity is incomplete/i);
  });
});
