jest.mock('../../src/modules/customer/repositories/customer.repository', () => {
  const state = { customer: null, events: [] };
  return {
    __state: state,
    createCustomer: jest.fn(async (payload) => {
      state.customer = { ...payload, _id: 'customer-id' };
      return state.customer;
    }),
    createEvent: jest.fn(async (payload) => {
      state.events.push(payload);
      return { ...payload, _id: `event-${state.events.length}` };
    }),
    findByIdentityKey: jest.fn(async () => state.customer),
    saveCustomer: jest.fn(async (payload) => {
      state.customer = { ...payload, _id: state.customer._id };
      return state.customer;
    }),
  };
});

const repository = require('../../src/modules/customer/repositories/customer.repository');
const service = require('../../src/modules/customer/services/customerProjection.service');

describe('customerProjection.service', () => {
  beforeEach(() => {
    repository.__state.customer = null;
    repository.__state.events = [];
    jest.clearAllMocks();
  });

  test('identity key prefers external buyer id', () => {
    expect(service.deriveIdentityKey({
      salesChannelCode: 'amazon',
      marketplaceCode: 'us',
      buyer: { externalBuyerId: 'buyer-1', emailMasked: 'masked@example.com' },
    })).toBe('AMAZON:US:buyer-1');
  });

  test('upsert is idempotent per order and becomes returning on second order', async () => {
    const base = {
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      buyer: { externalBuyerId: 'buyer-1', name: 'Jane' },
      shippingAddress: { countryCode: 'US', addressValidationStatus: 'VALID' },
      pricing: { customerPaidAmount: 2000, currency: 'USD' },
      quantity: 1,
    };

    await service.upsertFromOrderSnapshot({ ...base, orderId: '660000000000000000000001', externalOrderId: 'A-1' });
    await service.upsertFromOrderSnapshot({ ...base, orderId: '660000000000000000000001', externalOrderId: 'A-1' });
    expect(repository.__state.customer.orderCount).toBe(1);

    await service.upsertFromOrderSnapshot({ ...base, orderId: '660000000000000000000002', externalOrderId: 'A-2' });
    expect(repository.__state.customer.orderCount).toBe(2);
    expect(repository.__state.customer.lifecycle).toBe('RETURNING');
  });

  test('address issue marks care follow-up', async () => {
    await service.upsertFromOrderSnapshot({
      orderId: '660000000000000000000001',
      externalOrderId: 'A-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      buyer: { externalBuyerId: 'buyer-1' },
      shippingAddress: { countryCode: 'US', addressValidationStatus: 'INVALID' },
      pricing: { customerPaidAmount: 1000, currency: 'USD' },
      quantity: 1,
    });

    expect(repository.__state.customer.careStatus).toBe('NEEDS_FOLLOW_UP');
    expect(repository.__state.customer.riskFlags).toEqual([
      expect.objectContaining({ code: 'ADDRESS_ISSUE', count: 1 }),
    ]);
  });
});
