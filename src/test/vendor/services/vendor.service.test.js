jest.mock('../../../modules/vendor/repositories/vendor.repository', () => ({
  create: jest.fn(),
  findByCode: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/vendor/repositories/vendorProduct.repository', () => ({
  create: jest.fn(),
  findByCode: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveByProductTypeGroup: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/vendor/repositories/vendorCostCenter.repository', () => ({
  countByProduct: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveByProduct: jest.fn(),
  search: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  getProductTypeGroupById: jest.fn(),
}));

const errorCodes = require('../../../shared/constants/errorCodes');
const catalogPublic = require('../../../modules/catalog/public');
const vendorRepository = require('../../../modules/vendor/repositories/vendor.repository');
const productRepository = require('../../../modules/vendor/repositories/vendorProduct.repository');
const costCenterRepository = require('../../../modules/vendor/repositories/vendorCostCenter.repository');
const service = require('../../../modules/vendor/services/vendor.service');

describe('vendor.service', () => {
  const vendorId = '660000000000000000000501';
  const productId = '660000000000000000000601';
  const costCenterId = '660000000000000000000701';
  const groupId = '660000000000000000000301';

  beforeEach(() => {
    jest.clearAllMocks();
    vendorRepository.findById.mockResolvedValue({
      _id: vendorId,
      code: 'PRINTWAY',
      name: 'Printway',
      providerKey: 'PRINTWAY',
      fulfillmentType: 'POD',
      status: 'ACTIVE',
    });
    catalogPublic.getProductTypeGroupById.mockResolvedValue({
      _id: groupId,
      code: 'SHIRT',
      name: 'Shirt',
      status: 'ACTIVE',
    });
    productRepository.findById.mockResolvedValue({
      _id: productId,
      vendorId: {
        _id: vendorId,
        code: 'PRINTWAY',
        name: 'Printway',
        status: 'ACTIVE',
      },
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Premium Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      status: 'ACTIVE',
      baseCostAmount: 1200,
      currency: 'USD',
    });
    costCenterRepository.countByProduct.mockResolvedValue(0);
  });

  test('createVendor normalizes code and maps duplicate code to conflict', async () => {
    vendorRepository.create.mockResolvedValue({
      _id: vendorId,
      code: 'PRINTWAY',
      name: 'Printway',
      fulfillmentType: 'POD',
      status: 'ACTIVE',
    });

    const result = await service.createVendor({ code: ' printway ', name: 'Printway', fulfillmentType: 'pod' });

    expect(vendorRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PRINTWAY',
      fulfillmentType: 'POD',
    }));
    expect(result).toMatchObject({ id: vendorId, code: 'PRINTWAY', fulfillmentType: 'POD' });

    vendorRepository.create.mockRejectedValueOnce({ code: 11000 });
    await expect(service.createVendor({ code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD' }))
      .rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });
  });

  test('updateVendor strips code changes', async () => {
    vendorRepository.update.mockResolvedValue({
      _id: vendorId,
      code: 'PRINTWAY',
      name: 'Updated',
      fulfillmentType: 'FBM',
      status: 'ACTIVE',
    });

    await service.updateVendor(vendorId, { code: 'OTHER', name: 'Updated', fulfillmentType: 'fbm' });

    expect(vendorRepository.update).toHaveBeenCalledWith(vendorId, { name: 'Updated', fulfillmentType: 'FBM' });
  });

  test('findVendorByCode returns active only by default', async () => {
    vendorRepository.findByCode.mockResolvedValueOnce({ _id: vendorId, code: 'PRINTWAY', status: 'INACTIVE' });
    vendorRepository.findByCode.mockResolvedValueOnce({ _id: vendorId, code: 'PRINTWAY', status: 'INACTIVE' });

    await expect(service.findVendorByCode(' printway ')).resolves.toBeNull();
    await expect(service.findVendorByCode(' printway ', { includeInactive: true }))
      .resolves.toMatchObject({ code: 'PRINTWAY' });
    expect(vendorRepository.findByCode).toHaveBeenCalledWith('PRINTWAY');
  });

  test('createVendorProduct validates active vendor and product type group', async () => {
    productRepository.create.mockResolvedValue({
      _id: productId,
      vendorId: { _id: vendorId, code: 'PRINTWAY', name: 'Printway', status: 'ACTIVE' },
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Premium Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      status: 'ACTIVE',
      baseCostAmount: 1200,
      currency: 'USD',
    });

    const result = await service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: ' premium_shirt ',
      name: 'Premium Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      baseCostAmount: 1200,
    });

    expect(vendorRepository.findById).toHaveBeenCalledWith(vendorId);
    expect(catalogPublic.getProductTypeGroupById).toHaveBeenCalledWith(groupId);
    expect(productRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PREMIUM_SHIRT',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
    }));
    expect(result).toMatchObject({
      id: productId,
      code: 'PREMIUM_SHIRT',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      costCenterCount: 0,
    });
  });

  test('createVendorProduct rejects inactive vendor or inactive product type group', async () => {
    vendorRepository.findById.mockResolvedValueOnce({ _id: vendorId, status: 'INACTIVE' });
    await expect(service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: 'SHIRT',
      name: 'Shirt',
    })).rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });

    vendorRepository.findById.mockResolvedValueOnce({ _id: vendorId, status: 'ACTIVE' });
    catalogPublic.getProductTypeGroupById.mockResolvedValueOnce({ _id: groupId, status: 'INACTIVE' });
    await expect(service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: 'SHIRT',
      name: 'Shirt',
    })).rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });
  });

  test('updateVendorProduct strips vendorId/code and validates productTypeGroupId', async () => {
    productRepository.update.mockResolvedValue({
      _id: productId,
      vendorId: { _id: vendorId, code: 'PRINTWAY', name: 'Printway', status: 'ACTIVE' },
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Updated',
      imageUrl: 'https://cdn.example.test/updated.jpg',
      status: 'ACTIVE',
      baseCostAmount: 1300,
      currency: 'USD',
    });

    await service.updateVendorProduct(productId, {
      vendorId: '660000000000000000000999',
      code: 'OTHER',
      name: 'Updated',
      imageUrl: 'https://cdn.example.test/updated.jpg',
      productTypeGroupId: groupId,
    });

    expect(catalogPublic.getProductTypeGroupById).toHaveBeenCalledWith(groupId);
    expect(productRepository.update).toHaveBeenCalledWith(productId, {
      productTypeGroupId: groupId,
      name: 'Updated',
      imageUrl: 'https://cdn.example.test/updated.jpg',
    });
  });

  test('public listActiveVendorProductsByProductTypeGroup filters inactive vendors', async () => {
    productRepository.listActiveByProductTypeGroup.mockResolvedValue([
      { _id: productId, status: 'ACTIVE', vendorId: { _id: vendorId, status: 'ACTIVE' } },
      { _id: '660000000000000000000602', status: 'ACTIVE', vendorId: { _id: vendorId, status: 'INACTIVE' } },
    ]);

    await expect(service.listActiveVendorProductsByProductTypeGroup(groupId))
      .resolves.toHaveLength(1);
  });

  test('searchVendorCostCenters returns active enriched vendor cost center candidates', async () => {
    costCenterRepository.search.mockResolvedValue({
      items: [{
        vendor: { _id: vendorId, code: 'BEEFUL', name: 'Beeful', status: 'ACTIVE' },
        vendorProduct: { _id: productId, code: 'PRODUCT_1717', name: 'Heavyweight T-Shirt', status: 'ACTIVE' },
        vendorCostCenter: {
          _id: costCenterId,
          vendorProductId: productId,
          vendorId,
          code: 'PRODUCT_1717_M_PEPPER',
          name: 'M / PEPPER',
          sku: 'UT-1717-PER-M',
          standardSize: 'M',
          standardColor: 'PEPPER',
          baseCostAmount: 894,
          currency: 'USD',
          status: 'ACTIVE',
        },
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await service.searchVendorCostCenters({
      q: 'beeful',
      vendorId,
      size: 'M',
      color: 'PEPPER',
      page: 1,
      limit: 20,
    });

    expect(costCenterRepository.search).toHaveBeenCalledWith(expect.objectContaining({
      q: 'beeful',
      vendorId,
      size: 'M',
      color: 'PEPPER',
      status: 'ACTIVE',
    }));
    expect(result).toMatchObject({
      items: [{
        vendor: { id: vendorId, code: 'BEEFUL', name: 'Beeful' },
        vendorProduct: { id: productId, code: 'PRODUCT_1717', name: 'Heavyweight T-Shirt' },
        vendorCostCenter: {
          id: costCenterId,
          sku: 'UT-1717-PER-M',
          standardSize: 'M',
          standardColor: 'PEPPER',
          baseCostAmount: 894,
        },
      }],
      pagination: { total: 1, page: 1, limit: 20 },
    });
  });

  test('create/update cost centers validate parent and strip identity fields', async () => {
    costCenterRepository.create.mockResolvedValue({
      _id: costCenterId,
      vendorProductId: productId,
      vendorId,
      code: 'BLACK_L',
      name: 'Black L',
      vendorSize: 'L',
      vendorColor: 'Black',
      standardSize: 'L',
      standardColor: 'Black',
      status: 'ACTIVE',
      baseCostAmount: 1200,
      currency: 'USD',
    });
    costCenterRepository.findById.mockResolvedValue({
      _id: costCenterId,
      vendorProductId: productId,
      code: 'BLACK_L',
      name: 'Black L',
      status: 'ACTIVE',
    });
    costCenterRepository.update.mockResolvedValue({
      _id: costCenterId,
      vendorProductId: productId,
      code: 'BLACK_L',
      name: 'Updated',
      status: 'ACTIVE',
      baseCostAmount: 1300,
      currency: 'USD',
    });

    const created = await service.createVendorCostCenter(productId, {
      code: ' black_l ',
      name: 'Black L',
      vendorSize: 'L',
      vendorColor: 'Black',
      standardSize: 'L',
      standardColor: 'Black',
      domesticShipping: { economyAmount: 499 },
    });
    expect(costCenterRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      vendorProductId: productId,
      vendorId,
      code: 'BLACK_L',
      domesticShipping: { economyAmount: 499 },
    }));
    expect(created).toMatchObject({ code: 'BLACK_L', vendorSize: 'L', standardColor: 'Black' });

    await service.updateVendorCostCenter(productId, costCenterId, {
      vendorProductId: '660000000000000000000999',
      code: 'OTHER',
      name: 'Updated',
      standardSize: 'XL',
    });
    expect(costCenterRepository.update).toHaveBeenCalledWith(costCenterId, { name: 'Updated', standardSize: 'XL' });
  });
});
