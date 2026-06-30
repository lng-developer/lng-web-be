const CustomizationPayload = require('../../../modules/customization/models/customizationPayload.model');
const repository = require('../../../modules/customization/repositories/customizationPayload.repository');

jest.mock('../../../modules/customization/models/customizationPayload.model', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
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

  CustomizationPayload.find.mockReturnValue(chain);

  return chain;
}

function mockFindOneChain(item = null) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(item),
  };

  CustomizationPayload.findOne.mockReturnValue(chain);

  return chain;
}

describe('customizationPayload.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('list filters by accessible shop ids', async () => {
    mockFindChain([]);
    CustomizationPayload.countDocuments.mockResolvedValue(0);

    await repository.list({
      shopIds: ['660000000000000000000201', '660000000000000000000202'],
    });

    expect(CustomizationPayload.find).toHaveBeenCalledWith({
      shopId: {
        $in: ['660000000000000000000201', '660000000000000000000202'],
      },
    });
    expect(CustomizationPayload.countDocuments).toHaveBeenCalledWith({
      shopId: {
        $in: ['660000000000000000000201', '660000000000000000000202'],
      },
    });
  });

  test('findByOrderItem returns the latest payload by createdAt and _id', async () => {
    const chain = mockFindOneChain({ _id: '660000000000000000000602' });

    const result = await repository.findByOrderItem('660000000000000000000401');

    expect(CustomizationPayload.findOne).toHaveBeenCalledWith({
      orderItemId: '660000000000000000000401',
    });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(result).toEqual({ _id: '660000000000000000000602' });
  });
});
