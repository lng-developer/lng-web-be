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

  test('uses the submitted provider when the vendor snapshot is legacy data', () => {
    expect(deriveTrackingIdentity({
      ...identity,
      provider: 'PRINTWAY',
      payloadSnapshot: {
        ...identity.payloadSnapshot,
        vendorProduct: { vendor: { id: identity.payloadSnapshot.vendorProduct.vendor.id, providerKey: 'MERCHIZE' } },
      },
    }).provider).toBe('PRINTWAY');
  });

  test('derives MangoTee tracking identity from legacy order data when vendor ref is missing', () => {
    expect(deriveTrackingIdentity({
      ...identity,
      provider: null,
      vendorExternalOrderId: null,
      payloadSnapshot: {
        orderItem: { externalOrderId: '111-7258289-0765048' },
        vendorProduct: {
          vendor: {
            id: identity.payloadSnapshot.vendorProduct.vendor.id,
            code: 'MANGOTEE',
          },
        },
      },
    })).toMatchObject({
      provider: 'MANGOTEE',
      vendorExternalOrderId: '111-7258289-0765048',
    });
  });

  test('uses the marketplace order ID for LNG Group tracking', () => {
    expect(deriveTrackingIdentity({
      ...identity,
      provider: 'LNG_GROUP',
      vendorExternalOrderId: 'cmwaifiok0001l5079uxdo0pr',
      payloadSnapshot: {
        orderItem: { externalOrderId: '113-6964403-3922666' },
        vendorProduct: {
          vendor: { id: identity.payloadSnapshot.vendorProduct.vendor.id, code: 'LNG_GROUP' },
        },
      },
    })).toMatchObject({
      provider: 'LNG_GROUP',
      vendorExternalOrderId: '113-6964403-3922666',
    });
  });
});
