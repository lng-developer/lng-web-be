jest.mock('../../src/modules/finance/services/financeSnapshot.service', () => ({}));
jest.mock('../../src/modules/finance/services/financeImport.service', () => ({
  importAdsFromFile: jest.fn(),
}));

const financeImport = require('../../src/modules/finance/services/financeImport.service');
const financePublic = require('../../src/modules/finance/public');

describe('finance public import port', () => {
  test('exposes Ads file import for trusted integration workers', async () => {
    financeImport.importAdsFromFile.mockResolvedValue({ status: 'COMPLETED' });

    await expect(financePublic.importAdsFromFile(
      { path: 'C:/tmp/report.csv', originalname: 'report.csv' },
      { shopId: '660000000000000000000201', salesChannelCode: 'AMAZON', marketplaceCode: 'US' },
      { system: true, worker: true },
    )).resolves.toEqual({ status: 'COMPLETED' });
  });
});
