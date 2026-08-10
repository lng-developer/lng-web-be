jest.mock('../../../src/modules/mapping/models/mappingNormalizationRule.model', () => ({ aggregate: jest.fn() }));
jest.mock('../../../src/modules/mapping/models/mappingSkuConfigRule.model', () => ({ aggregate: jest.fn() }));
jest.mock('../../../src/modules/mapping/models/mappingSkuNormalizeRule.model', () => ({ aggregate: jest.fn() }));
jest.mock('../../../src/modules/mapping/models/vendorRoutingRule.model', () => ({ aggregate: jest.fn() }));

const models = [
  require('../../../src/modules/mapping/models/mappingNormalizationRule.model'),
  require('../../../src/modules/mapping/models/mappingSkuConfigRule.model'),
  require('../../../src/modules/mapping/models/mappingSkuNormalizeRule.model'),
  require('../../../src/modules/mapping/models/vendorRoutingRule.model'),
];
const repositories = [
  require('../../../src/modules/mapping/repositories/mappingNormalizationRule.repository'),
  require('../../../src/modules/mapping/repositories/mappingSkuConfigRule.repository'),
  require('../../../src/modules/mapping/repositories/mappingSkuNormalizeRule.repository'),
  require('../../../src/modules/mapping/repositories/vendorRoutingRule.repository'),
];

describe('mapping list repositories', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    models.forEach((model) => model.aggregate.mockResolvedValue([{ items: [{ _id: 'rule-1' }], total: [{ count: 7 }] }]));
  });

  test.each(repositories)('list uses one facet aggregation and preserves pagination', async (repository) => {
    await expect(repository.list({ page: 2, limit: 3 })).resolves.toEqual({
      items: [{ _id: 'rule-1' }],
      pagination: { total: 7, page: 2, limit: 3 },
    });
    const model = models[repositories.indexOf(repository)];
    expect(model.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ $facet: { items: [{ $skip: 3 }, { $limit: 3 }], total: [{ $count: 'count' }] } }),
    ]));
  });

  test('normalization groups semantic and value-alias pages in one query', async () => {
    models[0].aggregate.mockResolvedValueOnce([{
      semanticRules: [{ _id: 'semantic-1' }],
      semanticTotal: [{ count: 2 }],
      valueAliases: [{ _id: 'alias-1' }],
      valueAliasTotal: [{ count: 4 }],
    }]);

    await expect(repositories[0].listGrouped({ page: 1, limit: 20 })).resolves.toEqual({
      semanticRules: { items: [{ _id: 'semantic-1' }], pagination: { total: 2, page: 1, limit: 20 } },
      valueAliases: { items: [{ _id: 'alias-1' }], pagination: { total: 4, page: 1, limit: 20 } },
    });
    expect(models[0].aggregate).toHaveBeenCalledTimes(1);
  });
});
