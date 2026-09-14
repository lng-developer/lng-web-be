const { createAmazonAdsEmailImportService, reportUrlFromHtml } = require('../services/amazonAdsEmailImport.service');

describe('Amazon Ads Gmail report URLs', () => {
  test('accepts an Amazon Ads email redirect link', () => {
    const url = 'https://na.r.ads.amazon.com/CL0/https%3A%2F%2Fexample.s3.amazonaws.com%2Freport.csv';

    expect(reportUrlFromHtml(`<a href="${url}">Download</a>`)).toBe(url);
  });

  test('rejects a redirect that does not finish at Amazon S3', async () => {
    const client = {
      connect: jest.fn(),
      getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
      search: jest.fn().mockResolvedValue([1]),
      fetchOne: jest.fn().mockResolvedValue({ envelope: { messageId: 'report-1' }, source: 'email-source' }),
      messageFlagsAdd: jest.fn(),
      logout: jest.fn(),
    };
    const importMappedAdsFromFile = jest.fn();
    const service = createAmazonAdsEmailImportService({
      config: { enabled: true, user: 'ads@example.test', appPassword: 'secret', salesChannelCode: 'AMAZON', marketplaceCode: 'US' },
      createClient: () => client,
      parseMail: jest.fn().mockResolvedValue({
        from: { value: [{ address: 'no-reply@ads.amazon.com' }] },
        subject: 'Your report is ready: LNG Daily Campaign Spend',
        html: '<a href="https://na.r.ads.amazon.com/CL0/report">Download</a>',
      }),
      fetch: jest.fn().mockResolvedValue({ ok: true, url: 'https://example.test/report.csv' }),
      importMappedAdsFromFile,
      logger: { info: jest.fn(), warn: jest.fn() },
    });

    await expect(service.runOnce()).resolves.toEqual({ imported: 0, skipped: 0, pending: 0, failed: 1 });
    expect(importMappedAdsFromFile).not.toHaveBeenCalled();
    expect(client.messageFlagsAdd).not.toHaveBeenCalled();
  });
});
