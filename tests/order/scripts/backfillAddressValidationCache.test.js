jest.mock('../../../src/modules/order/models/order.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../../../src/modules/order/repositories/addressValidationCache.repository', () => ({
  computeAddressKey: jest.fn(() => 'mocked-key'),
  upsertCache: jest.fn(),
}));

const Order = require('../../../src/modules/order/models/order.model');
const addressValidationCacheRepository = require('../../../src/modules/order/repositories/addressValidationCache.repository');
const { backfillAddressValidationCache, parseArgs } = require('../../../src/modules/order/scripts/backfillAddressValidationCache');

describe('backfillAddressValidationCache script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parses CLI arguments accurately', () => {
    expect(parseArgs(['--apply=true', '--batch-size=50'])).toEqual({
      apply: 'true',
      'batch-size': '50',
    });
  });

  test('returns early when there are no valid orders', async () => {
    Order.countDocuments.mockResolvedValueOnce(0);

    const summary = await backfillAddressValidationCache({ apply: true });

    expect(summary.totalValidOrders).toBe(0);
    expect(Order.find).not.toHaveBeenCalled();
    expect(addressValidationCacheRepository.upsertCache).not.toHaveBeenCalled();
  });

  test('scans orders, deduplicates address keys, and upserts when apply=true', async () => {
    Order.countDocuments.mockResolvedValueOnce(2);

    const mockOrders = [
      {
        _id: 'order-1',
        shippingAddress: {
          addressLine1: '100 Main St',
          city: 'Dallas',
          stateOrProvince: 'TX',
          postalCode: '75001',
          countryCode: 'US',
        },
        externalData: {
          addressValidation: {
            provider: 'smarty',
            status: 'VALID',
            normalizedAddress: { addressLine1: '100 Main St', city: 'Dallas' },
          },
        },
      },
      {
        _id: 'order-2',
        shippingAddress: {
          addressLine1: '100 Main St',
          city: 'Dallas',
          stateOrProvince: 'TX',
          postalCode: '75001',
          countryCode: 'US',
        },
      },
    ];

    const lean = jest.fn()
      .mockResolvedValueOnce(mockOrders)
      .mockResolvedValueOnce([]);
    const select = jest.fn().mockReturnValue({ lean });
    const limit = jest.fn().mockReturnValue({ select });
    const sort = jest.fn().mockReturnValue({ limit });
    Order.find.mockReturnValue({ sort });

    addressValidationCacheRepository.upsertCache.mockResolvedValue({});

    const summary = await backfillAddressValidationCache({ apply: true, batchSize: 10 });

    expect(summary.totalValidOrders).toBe(2);
    expect(summary.uniqueAddressesProcessed).toBe(1); // deduplicated
    expect(summary.cachedCount).toBe(1);
    expect(addressValidationCacheRepository.upsertCache).toHaveBeenCalledTimes(1);
    expect(addressValidationCacheRepository.upsertCache).toHaveBeenCalledWith(
      'mocked-key',
      expect.objectContaining({
        status: 'VALID',
        normalizedAddress: expect.objectContaining({ addressLine1: '100 Main St' }),
      }),
    );
  });

  test('does not upsert when apply=false (dry-run)', async () => {
    Order.countDocuments.mockResolvedValueOnce(1);

    const mockOrders = [
      {
        _id: 'order-1',
        shippingAddress: {
          addressLine1: '200 Elm St',
          city: 'Austin',
          stateOrProvince: 'TX',
          postalCode: '73301',
          countryCode: 'US',
        },
      },
    ];

    const lean = jest.fn()
      .mockResolvedValueOnce(mockOrders)
      .mockResolvedValueOnce([]);
    const select = jest.fn().mockReturnValue({ lean });
    const limit = jest.fn().mockReturnValue({ select });
    const sort = jest.fn().mockReturnValue({ limit });
    Order.find.mockReturnValue({ sort });

    const summary = await backfillAddressValidationCache({ apply: false });

    expect(summary.totalValidOrders).toBe(1);
    expect(summary.uniqueAddressesProcessed).toBe(1);
    expect(summary.cachedCount).toBe(0);
    expect(addressValidationCacheRepository.upsertCache).not.toHaveBeenCalled();
  });
});
