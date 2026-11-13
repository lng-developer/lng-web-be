const { ObjectId } = require('mongodb');

jest.mock('../../../src/modules/vendor/repositories/vendor.repository', () => ({
  create: jest.fn(),
  findByCode: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActive: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorProduct.repository', () => ({
  create: jest.fn(),
  findByCode: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorCostCenter.repository', () => ({
  countByProduct: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findByProductAndCode: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorIntegrationConfig.repository', () => ({
  findByVendorId: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/services/vendorIntegrationAdapterRegistry.service', () => ({
  getAdapter: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorMigrationReview.repository', () => ({
  upsertReview: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/public', () => ({
  getProductTypeGroupById: jest.fn(),
}));

jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue(undefined),
}));

const vendorRepository = require('../../../src/modules/vendor/repositories/vendor.repository');
const productRepository = require('../../../src/modules/vendor/repositories/vendorProduct.repository');
const costCenterRepository = require('../../../src/modules/vendor/repositories/vendorCostCenter.repository');
const vendorService = require('../../../src/modules/vendor/services/vendor.service');
const { recordStatuses } = require('../../../src/modules/vendor/constants/vendor.constants');

describe('Unified Vendor Product & Variant Import', () => {
  const vendorId = new ObjectId().toString();
  const mockVendor = {
    _id: vendorId,
    code: 'PRINTWAY',
    name: 'Printway',
    status: recordStatuses.ACTIVE,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    vendorRepository.findById.mockResolvedValue(mockVendor);
  });

  describe('parseMoneyAmount helper', () => {
    const { parseMoneyAmount } = vendorService;

    it('converts dollar strings with decimals to integer minor units (cents)', () => {
      expect(parseMoneyAmount('12.00')).toBe(1200);
      expect(parseMoneyAmount('12.5')).toBe(1250);
      expect(parseMoneyAmount('12.50')).toBe(1250);
      expect(parseMoneyAmount('4.50')).toBe(450);
      expect(parseMoneyAmount('0.75')).toBe(75);
    });

    it('handles currency symbols and commas', () => {
      expect(parseMoneyAmount('$12.00')).toBe(1200);
      expect(parseMoneyAmount('$12')).toBe(1200);
      expect(parseMoneyAmount('€15.50')).toBe(1550);
      expect(parseMoneyAmount('$1,250.00')).toBe(125000);
    });

    it('preserves integer minor units without decimals (e.g. legacy cents)', () => {
      expect(parseMoneyAmount('1200')).toBe(1200);
      expect(parseMoneyAmount('450')).toBe(450);
      expect(parseMoneyAmount('800')).toBe(800);
      expect(parseMoneyAmount(1200)).toBe(1200);
    });

    it('converts float numbers by multiplying by 100', () => {
      expect(parseMoneyAmount(12.5)).toBe(1250);
    });

    it('handles zero and empty inputs', () => {
      expect(parseMoneyAmount('0')).toBe(0);
      expect(parseMoneyAmount(0)).toBe(0);
      expect(parseMoneyAmount('')).toBeUndefined();
      expect(parseMoneyAmount(null)).toBeUndefined();
      expect(parseMoneyAmount(undefined)).toBeUndefined();
    });

    it('throws validation error for invalid or negative inputs', () => {
      expect(() => parseMoneyAmount('abc', 'baseCostAmount')).toThrow(/must be a non-negative number/);
      expect(() => parseMoneyAmount('-5', 'baseCostAmount')).toThrow(/must be a non-negative number/);
    });
  });

  describe('importVendorProductsUnified', () => {
    it('creates 1 product and 3 variant cost centers from a multi-row CSV with dollar amounts', async () => {
      const productId = new ObjectId().toString();
      productRepository.findByCode.mockResolvedValue(null);
      productRepository.create.mockImplementation(async (payload) => ({
        ...payload,
        _id: productId,
      }));
      costCenterRepository.findByProductAndCode.mockResolvedValue(null);
      costCenterRepository.create.mockImplementation(async (payload) => ({
        ...payload,
        _id: new ObjectId().toString(),
      }));

      const rows = [
        {
          code: 'TEE-UNISEX',
          name: 'Unisex Heavy Cotton Tee',
          minProductionDays: '2',
          maxProductionDays: '5',
          size: 'S',
          color: 'Black',
          sku: 'TEE-BLK-S',
          baseCostAmount: '10.00',
          currency: 'USD',
          domesticEconomyAmount: '4.50',
          domesticAdditionalAmount: '1.50',
          status: 'ACTIVE',
        },
        {
          code: 'TEE-UNISEX',
          name: 'Unisex Heavy Cotton Tee',
          size: 'M',
          color: 'Black',
          sku: 'TEE-BLK-M',
          baseCostAmount: '10.00',
          currency: 'USD',
          domesticEconomyAmount: '4.50',
          domesticAdditionalAmount: '1.50',
          status: 'ACTIVE',
        },
        {
          code: 'TEE-UNISEX',
          name: 'Unisex Heavy Cotton Tee',
          size: '2XL',
          color: 'Black',
          sku: 'TEE-BLK-2XL',
          baseCostAmount: '12.50',
          currency: 'USD',
          domesticEconomyAmount: '4.50',
          domesticAdditionalAmount: '1.50',
          status: 'ACTIVE',
        },
      ];

      const result = await vendorService.importVendorProductsUnified({ vendorId, rows }, { accountId: 'acc_123' });

      expect(result).toEqual({
        total: 3,
        created: 4,
        createdProducts: 1,
        updatedProducts: 0,
        createdCostCenters: 3,
        updatedCostCenters: 0,
        failed: [],
      });

      // Product created once with code and base info
      expect(productRepository.create).toHaveBeenCalledTimes(1);
      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId,
          code: 'TEE-UNISEX',
          name: 'Unisex Heavy Cotton Tee',
          minProductionDays: 2,
          maxProductionDays: 5,
          baseCostAmount: 1000,
          currency: 'USD',
          status: 'ACTIVE',
        }),
      );

      // 3 Cost centers created
      expect(costCenterRepository.create).toHaveBeenCalledTimes(3);

      // Check S
      expect(costCenterRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorProductId: productId,
          code: 'TEE-UNISEX-S-BLACK',
          vendorSize: 'S',
          vendorColor: 'Black',
          baseCostAmount: 1000,
          domesticShipping: { economyAmount: 450, additionalAmount: 150 },
        }),
      );

      // Check 2XL with higher base cost ($12.50 -> 1250 cents)
      expect(costCenterRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorProductId: productId,
          code: 'TEE-UNISEX-2XL-BLACK',
          vendorSize: '2XL',
          vendorColor: 'Black',
          baseCostAmount: 1250,
          domesticShipping: { economyAmount: 450, additionalAmount: 150 },
        }),
      );
    });

    it('supports backward-compatible 18-column CSV without variants by creating a default cost center with shipping fees', async () => {
      const productId = new ObjectId().toString();
      productRepository.findByCode.mockResolvedValue(null);
      productRepository.create.mockImplementation(async (payload) => ({
        ...payload,
        _id: productId,
      }));
      costCenterRepository.findByProductAndCode.mockResolvedValue(null);
      costCenterRepository.create.mockImplementation(async (payload) => ({
        ...payload,
        _id: new ObjectId().toString(),
      }));

      // Exact columns matching user's vendor-product-import-template (1).csv
      const rows = [
        {
          code: 'TP-SHIRT',
          name: 'T-Shirt',
          minProductionDays: '2',
          maxProductionDays: '5',
          externalProductId: 'EXT-TSHIRT',
          baseCostAmount: '1200',
          currency: 'USD',
          domesticEconomyAmount: '450',
          domesticAdditionalAmount: '150',
          internationalEconomyAmount: '800',
          internationalAdditionalAmount: '300',
          priorityEconomyAmount: '1200',
          priorityAdditionalAmount: '400',
          importTaxAmount: '0',
          embroideryAmount: '0',
          twoSidedPrintAmount: '150',
          twoPositionPrintAmount: '150',
          status: 'ACTIVE',
        },
      ];

      const result = await vendorService.importVendorProductsUnified({ vendorId, rows }, { accountId: 'acc_123' });

      expect(result.createdProducts).toBe(1);
      expect(result.createdCostCenters).toBe(1);
      expect(result.failed).toHaveLength(0);

      // Cost center created with default code and preserved shipping / print fees
      expect(costCenterRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorProductId: productId,
          code: 'TP-SHIRT-DEFAULT',
          name: 'T-Shirt (Default)',
          baseCostAmount: 1200,
          domesticShipping: { economyAmount: 450, additionalAmount: 150 },
          internationalShipping: { economyAmount: 800, additionalAmount: 300 },
          priorityShipping: { economyAmount: 1200, additionalAmount: 400 },
          importTaxAmount: 0,
          additionalCosts: {
            embroideryAmount: 0,
            twoSidedPrintAmount: 150,
            twoPositionPrintAmount: 150,
          },
        }),
      );
    });

    it('updates existing product and cost centers when already present', async () => {
      const existingProduct = {
        _id: new ObjectId().toString(),
        vendorId,
        code: 'HOODIE',
        name: 'Old Hoodie Name',
        minProductionDays: 3,
        maxProductionDays: 7,
        baseCostAmount: 2000,
        currency: 'USD',
        status: 'ACTIVE',
      };
      const existingCostCenter = {
        _id: new ObjectId().toString(),
        vendorProductId: existingProduct._id,
        code: 'HOODIE-M-NAVY',
        name: 'Old CC Name',
        baseCostAmount: 2000,
        domesticShipping: { economyAmount: 500, additionalAmount: 200 },
      };

      productRepository.findByCode.mockResolvedValue(existingProduct);
      productRepository.update.mockResolvedValue({ ...existingProduct, name: 'Premium Heavy Hoodie' });
      costCenterRepository.findByProductAndCode.mockResolvedValue(existingCostCenter);
      costCenterRepository.update.mockResolvedValue({ ...existingCostCenter, baseCostAmount: 2200 });

      const rows = [
        {
          code: 'HOODIE',
          name: 'Premium Heavy Hoodie',
          size: 'M',
          color: 'Navy',
          baseCostAmount: '22.00',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ];

      const result = await vendorService.importVendorProductsUnified({ vendorId, rows }, { accountId: 'acc_123' });

      expect(result.updatedProducts).toBe(1);
      expect(result.updatedCostCenters).toBe(1);
      expect(result.failed).toHaveLength(0);

      expect(productRepository.update).toHaveBeenCalledWith(
        existingProduct._id,
        expect.objectContaining({ name: 'Premium Heavy Hoodie' }),
      );
      expect(costCenterRepository.update).toHaveBeenCalledWith(
        existingCostCenter._id,
        expect.objectContaining({ baseCostAmount: 2200 }),
      );
    });

    it('isolates row errors without failing entire batch', async () => {
      productRepository.findByCode.mockResolvedValue(null);
      productRepository.create.mockResolvedValue({
        _id: new ObjectId().toString(),
        vendorId,
        code: 'VALID-PRODUCT',
        name: 'Valid Product',
      });
      costCenterRepository.findByProductAndCode.mockResolvedValue(null);
      costCenterRepository.create.mockResolvedValue({});

      const rows = [
        {
          code: 'VALID-PRODUCT',
          name: 'Valid Product',
          minProductionDays: '2',
          maxProductionDays: '5',
          size: 'S',
          color: 'White',
        },
        {
          code: 'INVALID-PRODUCT',
          name: 'Invalid Days Product',
          minProductionDays: '10',
          maxProductionDays: '2', // min > max
        },
      ];

      const result = await vendorService.importVendorProductsUnified({ vendorId, rows });

      expect(result.createdProducts).toBe(1);
      expect(result.createdCostCenters).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toContain('Row 3:');
    });

    test('imports selected Merchize catalog products into VendorProduct and CostCenters', async () => {
      productRepository.findByCode.mockResolvedValue(null);
      const createdProductId = new ObjectId().toString();
      productRepository.create.mockResolvedValue({
        _id: createdProductId,
        vendorId,
        code: 'MZ-TSHIRT',
        name: 'Merchize Unisex T-Shirt',
      });
      costCenterRepository.findByProductAndCode.mockResolvedValue(null);
      costCenterRepository.create.mockResolvedValue({});

      const mockProducts = [
        {
          sku: 'MZ-TSHIRT',
          title: 'Merchize Unisex T-Shirt',
          printing_methods: ['DTG'],
          variants: [
            {
              sku: 'MZ-TSHIRT-BLK-S',
              attributes: [
                { name: 'size', type: 'size', value_text: 'S' },
                { name: 'color', type: 'color', value_text: 'Black' },
              ],
              tiers: [{ name: 'tier1', price: 12.5 }],
              shipping_prices: [
                { to_zone: 'US', first_item: 4.5, additional_item: 1.5 },
                { to_zone: 'ROW', first_item: 8.0, additional_item: 3.0 },
              ],
            },
          ],
        },
      ];

      const result = await vendorService.importMerchizeCatalogProducts(
        {
          vendorId,
          products: mockProducts,
          tierName: 'tier1',
        },
        {},
      );

      expect(result.createdProducts).toBe(1);
      expect(result.createdCostCenters).toBe(1);
      expect(result.failed).toHaveLength(0);

      expect(costCenterRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        vendorProductId: createdProductId,
        vendorId,
        code: 'MZ-TSHIRT-BLK-S',
        vendorSize: 'S',
        vendorColor: 'Black',
        baseCostAmount: 1250,
        domesticShipping: {
          economyAmount: 450,
          additionalAmount: 150,
        },
        internationalShipping: {
          economyAmount: 800,
          additionalAmount: 300,
        },
      }));
    });
  });
});
