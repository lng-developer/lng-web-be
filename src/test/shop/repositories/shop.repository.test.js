const Shop = require('../../../modules/shop/models/shop.model');
const shopRepository = require('../../../modules/shop/repositories/shop.repository');

jest.mock('../../../modules/shop/models/shop.model', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

function mockFindChain(items = []) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
  };

  Shop.find.mockReturnValue(chain);

  return chain;
}

describe('shopRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates shop', async () => {
    const document = {
      toObject: jest.fn().mockReturnValue({ _id: 'shop-id', name: 'LNG Amazon US' }),
    };
    Shop.create.mockResolvedValue(document);

    const result = await shopRepository.create({ name: 'LNG Amazon US' });

    expect(Shop.create).toHaveBeenCalledWith({ name: 'LNG Amazon US' });
    expect(result).toEqual({ _id: 'shop-id', name: 'LNG Amazon US' });
  });

  test('findById returns lean object', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'shop-id', name: 'LNG Amazon US' });
    Shop.findById.mockReturnValue({ lean });

    const result = await shopRepository.findById('shop-id');

    expect(Shop.findById).toHaveBeenCalledWith('shop-id');
    expect(lean).toHaveBeenCalled();
    expect(result).toEqual({ _id: 'shop-id', name: 'LNG Amazon US' });
  });

  test('updateStatus changes ACTIVE to INACTIVE', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'shop-id', status: 'INACTIVE' });
    Shop.findByIdAndUpdate.mockReturnValue({ lean });

    const result = await shopRepository.updateStatus('shop-id', 'INACTIVE');

    expect(Shop.findByIdAndUpdate).toHaveBeenCalledWith(
      'shop-id',
      { $set: { status: 'INACTIVE' } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(result.status).toBe('INACTIVE');
  });

  test('updateStatus rejects invalid status', async () => {
    const lean = jest.fn().mockRejectedValue(new Error('Shop validation failed'));
    Shop.findByIdAndUpdate.mockReturnValue({ lean });

    await expect(shopRepository.updateStatus('shop-id', 'DELETED')).rejects.toThrow('Shop validation failed');

    expect(Shop.findByIdAndUpdate.mock.calls[0][2].runValidators).toBe(true);
  });

  test('list pagination works', async () => {
    const chain = mockFindChain([{ _id: 'shop-id' }]);
    Shop.countDocuments.mockResolvedValue(11);

    const result = await shopRepository.list({ page: 2, limit: 5 });

    expect(Shop.find).toHaveBeenCalledWith({});
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(5);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(result).toEqual({
      items: [{ _id: 'shop-id' }],
      total: 11,
      page: 2,
      limit: 5,
    });
  });

  test('list search by name works', async () => {
    mockFindChain([]);
    Shop.countDocuments.mockResolvedValue(0);

    await shopRepository.list({ search: ' lng ' });

    const filter = Shop.find.mock.calls[0][0];

    expect(filter.name).toBeInstanceOf(RegExp);
    expect(filter.name.test('LNG Amazon US')).toBe(true);
    expect(filter.name.test('Other LNG Shop')).toBe(false);
    expect(Shop.countDocuments).toHaveBeenCalledWith(filter);
  });

  test('list filter by status works', async () => {
    mockFindChain([]);
    Shop.countDocuments.mockResolvedValue(0);

    await shopRepository.list({ status: 'ACTIVE' });

    expect(Shop.find).toHaveBeenCalledWith({ status: 'ACTIVE' });
    expect(Shop.countDocuments).toHaveBeenCalledWith({ status: 'ACTIVE' });
  });

  test('list filters by shop id', async () => {
    mockFindChain([]);
    Shop.countDocuments.mockResolvedValue(0);

    await shopRepository.list({ id: '660000000000000000000001' });

    expect(Shop.find).toHaveBeenCalledWith({ _id: '660000000000000000000001' });
    expect(Shop.countDocuments).toHaveBeenCalledWith({ _id: '660000000000000000000001' });
  });

  test('list filters by accessible shop ids', async () => {
    mockFindChain([]);
    Shop.countDocuments.mockResolvedValue(0);

    await shopRepository.list({
      shopIds: ['660000000000000000000001', '660000000000000000000002'],
    });

    expect(Shop.find).toHaveBeenCalledWith({
      _id: {
        $in: ['660000000000000000000001', '660000000000000000000002'],
      },
    });
  });
});
