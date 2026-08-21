jest.mock('../../../src/modules/catalog/public', () => ({
  findProductTypeGroupByCode: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/services/vendor.service', () => ({
  createVendor: jest.fn(),
  updateVendor: jest.fn(),
  findVendorByCode: jest.fn(),
  findVendorByLegacyId: jest.fn(),
  createVendorProduct: jest.fn(),
  updateVendorProduct: jest.fn(),
  findVendorProductByCode: jest.fn(),
  findVendorProductByLegacyId: jest.fn(),
  createVendorCostCenter: jest.fn(),
  updateVendorCostCenter: jest.fn(),
  findVendorCostCenterByCode: jest.fn(),
  findVendorCostCenterByLegacyId: jest.fn(),
  stageVendorMigrationReviews: jest.fn(),
}));

const catalogPublic = require('../../../src/modules/catalog/public');
const vendorService = require('../../../src/modules/vendor/services/vendor.service');
const {
  buildVendorMigrationReviewRows,
  importVendorTemplateRows,
} = require('../../../src/modules/vendor/scripts/importVendorTemplate');

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
          printMethod: 'DTF',
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
          printMethod: 'DTF',
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
    }), { import: true });
    expect(vendorService.createVendorProduct).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'vendor1',
      productTypeGroupId: 'group1',
      code: 'PRODUCT_1',
      productUrl: 'https://vendor.example.test/product-1',
      imageUrl: 'https://example.test/product.jpg',
      designTemplateUrl: 'https://drive.example.test/template',
      minProductionDays: 2,
      maxProductionDays: 4,
    }), { import: true });
    expect(vendorService.createVendorCostCenter).toHaveBeenCalledWith('product1', expect.objectContaining({
      code: 'PRODUCT_1_BLACK_L',
      weight: 5.3,
      width: 13,
      baseCostAmount: 1200,
      importTaxAmount: 28,
      printMethod: 'DTF',
    }), { import: true });
    expect(vendorService.updateVendor).toHaveBeenCalledWith('vendor1', expect.any(Object), { import: true });
    expect(vendorService.createVendorProduct).toHaveBeenCalledWith(expect.any(Object), { import: true });
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

  test('updates legacy rows by legacy id and skips merge-review rows', async () => {
    catalogPublic.findProductTypeGroupByCode.mockResolvedValue({ _id: 'group1', status: 'ACTIVE' });
    vendorService.findVendorByLegacyId.mockResolvedValue({ _id: 'vendor1' });
    vendorService.findVendorProductByLegacyId.mockResolvedValue({ _id: 'product1' });
    vendorService.findVendorCostCenterByLegacyId.mockResolvedValue({ _id: 'cost1' });

    const summary = await importVendorTemplateRows({
      dryRun: false,
      vendors: [{ legacyId: 'legacy-vendor', code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD' }],
      vendorProducts: [{ legacyId: 'legacy-product', vendorCode: 'PRINTWAY', code: 'RENAMED', name: 'Product', productTypeGroupCode: 'GROUP_1' }],
      vendorCostCenters: [
        { legacyId: 'legacy-cost', legacyVendorProductId: 'legacy-product', vendorProductCode: 'RENAMED', code: 'RENAMED_BLACK', name: 'Black' },
        { legacyId: 'review-cost', legacyVendorProductId: 'legacy-product', vendorProductCode: 'RENAMED', code: 'REVIEW', name: 'Review', migrationAction: 'MERGE_REVIEW' },
      ],
    });

    expect(vendorService.updateVendorProduct).toHaveBeenCalledWith('product1', expect.objectContaining({ code: 'RENAMED' }), { import: true });
    expect(vendorService.updateVendorCostCenter).toHaveBeenCalledWith('product1', 'cost1', expect.objectContaining({ code: 'RENAMED_BLACK' }), { import: true });
    expect(summary.skipped.vendorCostCenters).toBe(1);
  });

  test('stages merge-review products without creating production vendor products', async () => {
    const summary = await importVendorTemplateRows({
      dryRun: false,
      skipInvalidRows: true,
      vendors: [{ legacyId: 'legacy-vendor', code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD' }],
      vendorProducts: [{
        legacyId: 'legacy-product-review', legacyVendorId: 'legacy-vendor', vendorCode: 'PRINTWAY',
        code: 'REVIEW_PRODUCT', name: 'Review Product', externalProductId: 'external-1', migrationAction: 'MERGE_REVIEW',
      }],
      vendorCostCenters: [{ legacyVendorProductId: 'legacy-product-review', migrationAction: 'MERGE_REVIEW' }],
    });

    expect(summary.skipped.vendorProducts).toBe(1);
    expect(vendorService.createVendorProduct).not.toHaveBeenCalled();
    expect(vendorService.stageVendorMigrationReviews).toHaveBeenCalledWith([expect.objectContaining({
      legacyProductId: 'legacy-product-review', vendorCode: 'PRINTWAY', vendorName: 'Printway', variantCount: 1,
    })]);
  });

  test('buildVendorMigrationReviewRows keeps only review products with legacy IDs', () => {
    expect(buildVendorMigrationReviewRows({
      vendors: [{ code: 'PRINTWAY', name: 'Printway' }],
      vendorProducts: [
        { legacyId: 'legacy-product-review', vendorCode: 'PRINTWAY', code: 'REVIEW', name: 'Review', migrationAction: 'MERGE_REVIEW' },
        { legacyId: 'legacy-product-import', vendorCode: 'PRINTWAY', code: 'IMPORT', name: 'Import' },
      ],
      vendorCostCenters: [{ legacyVendorProductId: 'legacy-product-review', migrationAction: 'MERGE_REVIEW' }],
    })).toEqual([expect.objectContaining({ legacyProductId: 'legacy-product-review', variantCount: 1 })]);
  });

  test('buildVendorMigrationReviewRows keeps an orphan review product visible', () => {
    expect(buildVendorMigrationReviewRows({
      vendorProducts: [{ legacyId: 'legacy-orphan', code: 'ORPHAN', name: 'Orphan', migrationAction: 'MERGE_REVIEW' }],
    })).toEqual([expect.objectContaining({ legacyProductId: 'legacy-orphan', vendorCode: null, vendorName: null })]);
  });
});
