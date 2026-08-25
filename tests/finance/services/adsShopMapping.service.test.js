jest.mock('../../../src/modules/auth/public', () => ({ canAccessScope: jest.fn() }));
jest.mock('../../../src/modules/finance/repositories/adsShopMapping.repository', () => ({
  findActiveByExternalIds: jest.fn(),
  list: jest.fn(),
  upsert: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const repository = require('../../../src/modules/finance/repositories/adsShopMapping.repository');
const service = require('../../../src/modules/finance/services/adsShopMapping.service');

describe('adsShopMapping.service', () => {
  const shopId = '660000000000000000140003';
  const context = { salesChannelCode: 'AMAZON', marketplaceCode: 'US' };

  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
  });

  test('resolves campaign before portfolio for an advertiser account', async () => {
    repository.findActiveByExternalIds.mockResolvedValue([
      { matchType: 'PORTFOLIO', externalId: 'portfolio-1', shopId: '660000000000000000140002' },
      { matchType: 'CAMPAIGN', externalId: 'campaign-1', shopId },
    ]);

    await expect(service.resolveShopForAdsRow({
      advertiserAccountId: '="amzn1.ads-account.g.llc"', campaignId: '="campaign-1"', portfolioId: 'portfolio-1',
    }, context, { system: true })).resolves.toEqual({ shopId, matchedBy: 'CAMPAIGN' });
    expect(repository.findActiveByExternalIds).toHaveBeenCalledWith(expect.objectContaining({
      advertiserAccountId: 'amzn1.ads-account.g.llc', externalIds: ['campaign-1', 'portfolio-1'],
    }));
  });

  test('leaves a row unassigned when no active mapping exists', async () => {
    repository.findActiveByExternalIds.mockResolvedValue([]);

    await expect(service.resolveShopForAdsRow({
      advertiserAccountId: 'account-1', campaignId: 'campaign-1', portfolioId: null,
    }, context, { system: true })).resolves.toEqual({ shopId: null, matchedBy: 'UNASSIGNED' });
  });

  test('upserts normalized campaign mappings for a shop', async () => {
    repository.upsert.mockResolvedValue({ _id: '660000000000000000140004' });

    await service.upsertAdsShopMapping({
      advertiserAccountId: '="account-1"', matchType: 'CAMPAIGN', externalId: '="campaign-1"', shopId,
    }, { system: true });

    expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      advertiserAccountId: 'account-1', externalId: 'campaign-1', shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US',
    }));
  });
});
