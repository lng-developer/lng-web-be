jest.mock('../../../modules/mapping/models/mappingSkuNormalizeRule.model', () => ({
  find: jest.fn(),
}));

const MappingSkuNormalizeRule = require('../../../modules/mapping/models/mappingSkuNormalizeRule.model');
const repository = require('../../../modules/mapping/repositories/mappingSkuNormalizeRule.repository');

describe('mappingSkuNormalizeRule.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MappingSkuNormalizeRule.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
  });

  test('loads config-scoped normalize rules before canonical config is known', async () => {
    await repository.listActiveForContext({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      configCode: 'Z',
    });

    const filter = MappingSkuNormalizeRule.find.mock.calls[0][0];
    expect(filter.$and).not.toContainEqual({ $or: [{ configCode: null }, { configCode: 'Z' }] });
  });
});
