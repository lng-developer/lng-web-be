jest.mock('../../../src/modules/order/models/addressValidationCache.model', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

const AddressValidationCache = require('../../../src/modules/order/models/addressValidationCache.model');
const repository = require('../../../src/modules/order/repositories/addressValidationCache.repository');

describe('addressValidationCache repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('computeAddressKey', () => {
    test('normalizes casing, periods, whitespace, and US state names', () => {
      const addr1 = {
        addressLine1: '123 N. Main St., Suite #100',
        city: '  DALLAS ',
        stateOrProvince: 'Texas',
        postalCode: '75001-1234',
        countryCode: 'us',
      };
      const addr2 = {
        addressLine1: '123 n main st suite 100',
        city: 'dallas',
        stateOrProvinceCode: 'TX',
        postalCode: '75001',
        countryCode: 'US',
      };

      const key1 = repository.computeAddressKey(addr1);
      const key2 = repository.computeAddressKey(addr2);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64);
    });

    test('distinguishes different street addresses in the same city/zip', () => {
      const addr1 = { addressLine1: '100 Main St', city: 'Dallas', postalCode: '75001' };
      const addr2 = { addressLine1: '200 Main St', city: 'Dallas', postalCode: '75001' };

      expect(repository.computeAddressKey(addr1)).not.toBe(repository.computeAddressKey(addr2));
    });
  });

  describe('findByKey', () => {
    test('returns null when key is falsy', async () => {
      await expect(repository.findByKey(null)).resolves.toBeNull();
      expect(AddressValidationCache.findOne).not.toHaveBeenCalled();
    });

    test('calls findOne with lean', async () => {
      const cached = { addressKey: 'k1', status: 'VALID' };
      const lean = jest.fn().mockResolvedValue(cached);
      AddressValidationCache.findOne.mockReturnValue({ lean });

      await expect(repository.findByKey('k1')).resolves.toEqual(cached);
      expect(AddressValidationCache.findOne).toHaveBeenCalledWith({ addressKey: 'k1' });
      expect(lean).toHaveBeenCalled();
    });
  });

  describe('upsertCache', () => {
    test('upserts cache entry and returns updated document', async () => {
      const lean = jest.fn().mockResolvedValue({ addressKey: 'k1', status: 'VALID' });
      AddressValidationCache.findOneAndUpdate.mockReturnValue({ lean });

      const data = {
        rawAddress: { street: '123 Main' },
        provider: 'smarty',
        status: 'VALID',
        reason: 'postal-match',
        normalizedAddress: { addressLine1: '123 Main St' },
      };

      const result = await repository.upsertCache('k1', data);

      expect(AddressValidationCache.findOneAndUpdate).toHaveBeenCalledWith(
        { addressKey: 'k1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            addressKey: 'k1',
            status: 'VALID',
            provider: 'smarty',
          }),
          $setOnInsert: { hitCount: 0, lastHitAt: null },
        }),
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
      );
      expect(result).toEqual({ addressKey: 'k1', status: 'VALID' });
    });
  });

  describe('recordHit', () => {
    test('increments hitCount and sets lastHitAt', async () => {
      AddressValidationCache.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await repository.recordHit('k1');

      expect(AddressValidationCache.updateOne).toHaveBeenCalledWith(
        { addressKey: 'k1' },
        expect.objectContaining({
          $inc: { hitCount: 1 },
          $set: { lastHitAt: expect.any(Date) },
        }),
      );
    });

    test('returns null if addressKey is falsy', async () => {
      await expect(repository.recordHit('')).resolves.toBeNull();
      expect(AddressValidationCache.updateOne).not.toHaveBeenCalled();
    });
  });
});
