jest.mock('../../../src/modules/mapping/models/mappingSkuConfigRule.model', () => ({
  find: jest.fn(),
}));

const MappingSkuConfigRule = require('../../../src/modules/mapping/models/mappingSkuConfigRule.model');
const repository = require('../../../src/modules/mapping/repositories/mappingSkuConfigRule.repository');

describe('mappingSkuConfigRule.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MappingSkuConfigRule.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
  });

  test('context lookup does not filter by country when context has no country', async () => {
    await repository.findActiveForContext({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      configCode: 'NK',
    });

    const filter = MappingSkuConfigRule.find.mock.calls[0][0];
    expect(filter.$and).not.toContainEqual({ $or: [{ countryCode: null }, { countryCode: null }] });
  });
});
