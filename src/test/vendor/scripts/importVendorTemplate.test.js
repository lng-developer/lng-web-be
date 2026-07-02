jest.mock('../../../modules/catalog/public', () => ({
  findProductTypeGroupByCode: jest.fn(),
}));

jest.mock('../../../modules/vendor/services/vendor.service', () => ({
  createVendor: jest.fn(),
  updateVendor: jest.fn(),
  findVendorByCode: jest.fn(),
  createVendorProduct: jest.fn(),
  updateVendorProduct: jest.fn(),
  findVendorProductByCode: jest.fn(),
  createVendorCostCenter: jest.fn(),
  updateVendorCostCenter: jest.fn(),
  findVendorCostCenterByCode: jest.fn(),
}));

const catalogPublic = require('../../../modules/catalog/public');
const vendorService = require('../../../modules/vendor/services/vendor.service');
const {
  importVendorTemplateRows,
} = require('../../../modules/vendor/scripts/importVendorTemplate');

describe('importVendorTemplateRows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('dry-run validates links without writing vendors/products/cost centers', async () => {
    catalogPublic.findProductTypeGroupByCode.mockResolvedValue(null);

    const summary = await importVendorTemplateRows({
      dryRun: true,
      vendors: [
        { code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD', status: 'ACTIVE' },
      ],
      vendorProducts: [
        {
          vendorCode: 'PRINTWAY',
          code: 'PRODUCT_1',
          name: 'Product 1',
          productTypeGroupCode: 'MISSING_GROUP',
          baseCostAmount: '1000',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ],
      vendorCostCenters: [],
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.valid).toBe(false);
    expect(summary.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'UNKNOWN_PRODUCT_TYPE_GROUP_CODE', key: 'MISSING_GROUP' }),
    ]));
    expect(vendorService.createVendor).not.toHaveBeenCalled();
    expect(vendorService.createVendorProduct).not.toHaveBeenCalled();
    expect(vendorService.createVendorCostCenter).not.toHaveBeenCalled();
  });

  test('imports rows idempotently by updating existing records and creating missing records', async () => {
    catalogPublic.findProductTypeGroupByCode.mockResolvedValue({ _id: 'group1', status: 'ACTIVE' });
    vendorService.findVendorByCode.mockResolvedValueOnce({ _id: 'vendor1' });
    vendorService.findVendorProductByCode.mockResolvedValueOnce(null);
    vendorService.createVendorProduct.mockResolvedValueOnce({ id: 'product1' });
    vendorService.findVendorCostCenterByCode.mockResolvedValueOnce(null);
    vendorService.createVendorCostCenter.mockResolvedValueOnce({ id: 'cost1' });

    const summary = await importVendorTemplateRows({
      dryRun: false,
      vendors: [
        { code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD', status: 'ACTIVE' },
      ],
      vendorProducts: [
        {
          vendorCode: 'PRINTWAY',
          code: 'PRODUCT_1',
          name: 'Product 1',
          productTypeGroupCode: 'GROUP_1',
          productUrl: 'https://vendor.example.test/product-1',
          imageUrl: 'https://example.test/product.jpg',
          designTemplateUrl: 'https://drive.example.test/template',
          minProductionDays: '2',
          maxProductionDays: '4',
          baseCostAmount: '1000',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ],
      vendorCostCenters: [
        {
          vendorProductCode: 'PRODUCT_1',
          code: 'PRODUCT_1_BLACK_L',
          name: 'Black / L',
          weight: '5.3',
          weightUnit: 'OZ',
          width: '13',
          length: '10',
          height: '2',
          dimensionUnit: 'IN',
          baseCostAmount: '1200',
          importTaxAmount: '28',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ],
    });

    expect(summary.valid).toBe(true);
    expect(summary.created.vendorProducts).toBe(1);
    expect(summary.created.vendorCostCenters).toBe(1);
    expect(vendorService.updateVendor).toHaveBeenCalledWith('vendor1', expect.objectContaining({
      name: 'Printway',
      fulfillmentType: 'POD',
    }));
    expect(vendorService.createVendorProduct).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'vendor1',
      productTypeGroupId: 'group1',
      code: 'PRODUCT_1',
      productUrl: 'https://vendor.example.test/product-1',
      imageUrl: 'https://example.test/product.jpg',
      designTemplateUrl: 'https://drive.example.test/template',
      minProductionDays: 2,
      maxProductionDays: 4,
    }));
    expect(vendorService.createVendorCostCenter).toHaveBeenCalledWith('product1', expect.objectContaining({
      code: 'PRODUCT_1_BLACK_L',
      weight: 5.3,
      width: 13,
      baseCostAmount: 1200,
      importTaxAmount: 28,
    }));
  });

  test('skipInvalidRows imports valid rows and skips products without product type groups', async () => {
    catalogPublic.findProductTypeGroupByCode
      .mockResolvedValueOnce({ _id: 'group1', status: 'ACTIVE' })
      .mockResolvedValueOnce(null);
    vendorService.findVendorByCode.mockResolvedValueOnce(null);
    vendorService.createVendor.mockResolvedValueOnce({ id: 'vendor1' });
    vendorService.findVendorProductByCode.mockResolvedValueOnce(null);
    vendorService.createVendorProduct.mockResolvedValueOnce({ id: 'product1' });
    vendorService.findVendorCostCenterByCode.mockResolvedValueOnce(null);
    vendorService.createVendorCostCenter.mockResolvedValueOnce({ id: 'cost1' });

    const summary = await importVendorTemplateRows({
      dryRun: false,
      skipInvalidRows: true,
      vendors: [
        { code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD', status: 'ACTIVE' },
      ],
      vendorProducts: [
        {
          legacyId: 'legacy-product-1',
          vendorCode: 'PRINTWAY',
          code: 'PRODUCT_1',
          name: 'Product 1',
          productTypeGroupCode: 'GROUP_1',
          baseCostAmount: '1000',
          currency: 'USD',
          status: 'ACTIVE',
        },
        {
          legacyId: 'legacy-product-2',
          vendorCode: 'PRINTWAY',
          code: 'PRODUCT_2',
          name: 'Product 2',
          productTypeGroupCode: 'MISSING_GROUP',
          baseCostAmount: '1000',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ],
      vendorCostCenters: [
        {
          legacyVendorProductId: 'legacy-product-1',
          vendorProductCode: 'PRODUCT_1',
          code: 'PRODUCT_1_BLACK_L',
          name: 'Black / L',
          baseCostAmount: '1200',
          currency: 'USD',
          status: 'ACTIVE',
        },
        {
          legacyVendorProductId: 'legacy-product-2',
          vendorProductCode: 'PRODUCT_2',
          code: 'PRODUCT_2_BLACK_L',
          name: 'Black / L',
          baseCostAmount: '1200',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ],
    });

    expect(summary.valid).toBe(false);
    expect(summary.skipped.vendorProducts).toBe(1);
    expect(summary.skipped.vendorCostCenters).toBe(1);
    expect(summary.created.vendorProducts).toBe(1);
    expect(summary.created.vendorCostCenters).toBe(1);
    expect(vendorService.createVendorProduct).toHaveBeenCalledTimes(1);
    expect(vendorService.createVendorCostCenter).toHaveBeenCalledTimes(1);
  });
});
