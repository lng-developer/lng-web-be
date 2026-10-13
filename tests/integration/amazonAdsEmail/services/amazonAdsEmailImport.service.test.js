const { createAmazonAdsEmailImportService } = require('../../../../src/modules/integration/amazonAdsEmail/services/amazonAdsEmailImport.service');

describe('amazonAdsEmailImport.service', () => {
  const config = {
    enabled: true,
    user: 'lng.developer.workspace@gmail.com',
    appPassword: 'not-a-real-password',
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'US',
  };

  function setup(overrides = {}) {
    const client = {
      on: jest.fn(),
      connect: jest.fn(),
      logout: jest.fn(),
      search: jest.fn().mockResolvedValue([1]),
      fetchOne: jest.fn().mockResolvedValue({
        envelope: { messageId: '<daily-report@example>' },
        source: Buffer.from('raw'),
      }),
      messageFlagsAdd: jest.fn(),
    };
    const lock = { release: jest.fn() };
    client.getMailboxLock = jest.fn().mockResolvedValue(lock);
    const deps = {
      config,
      createClient: jest.fn(() => client),
      parseMail: jest.fn().mockResolvedValue({
        from: { value: [{ address: 'no-reply@ads.amazon.com' }] },
        subject: 'Your report is ready: LNG Daily Campaign Spend',
        html: '<a href="https://decorated-reports-prod-iad.s3.amazonaws.com/report.csv?sig=redacted">Download</a>',
      }),
      fetch: jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => Buffer.from('csv').buffer }),
      fs: { promises: { mkdtemp: jest.fn().mockResolvedValue('C:/tmp/ads-mail'), writeFile: jest.fn(), rm: jest.fn() } },
      os: { tmpdir: () => 'C:/tmp' },
      path: { join: (...parts) => parts.join('/') },
      importMappedAdsFromFile: jest.fn().mockResolvedValue({ importedShops: 1, unassignedRows: 0, complete: true }),
      logger: { info: jest.fn(), warn: jest.fn() },
      ...overrides,
    };
    return { client, lock, deps };
  }

  test('imports one trusted Amazon report and marks its email seen', async () => {
    const { client, deps } = setup();
    const service = createAmazonAdsEmailImportService(deps);

    await expect(service.runOnce()).resolves.toEqual({ imported: 1, skipped: 0, pending: 0, failed: 0 });

    expect(deps.importMappedAdsFromFile).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'amazon-ads-report.csv' }),
      expect.objectContaining({ sourceRef: 'gmail:<daily-report@example>' }),
      expect.objectContaining({ system: true, worker: true }),
    );
    expect(client.messageFlagsAdd).toHaveBeenCalledWith(1, ['\\Seen'], { uid: true });
  });

  test('rejects an untrusted sender without downloading or marking read', async () => {
    const { client, deps } = setup({
      parseMail: jest.fn().mockResolvedValue({
        from: { value: [{ address: 'attacker@example.com' }] },
        subject: 'Your report is ready: LNG Daily Campaign Spend',
        html: '<a href="https://decorated-reports-prod-iad.s3.amazonaws.com/report.csv">Download</a>',
      }),
    });

    await expect(createAmazonAdsEmailImportService(deps).runOnce())
      .resolves.toEqual({ imported: 0, skipped: 1, pending: 0, failed: 0 });

    expect(deps.fetch).not.toHaveBeenCalled();
    expect(client.messageFlagsAdd).not.toHaveBeenCalled();
  });

  test('rejects a report link outside Amazon S3', async () => {
    const { deps } = setup({
      parseMail: jest.fn().mockResolvedValue({
        from: { value: [{ address: 'no-reply@ads.amazon.com' }] },
        subject: 'Your report is ready: LNG Daily Campaign Spend',
        html: '<a href="https://attacker.example/report.csv">Download</a>',
      }),
    });

    await expect(createAmazonAdsEmailImportService(deps).runOnce())
      .resolves.toEqual({ imported: 0, skipped: 1, pending: 0, failed: 0 });

    expect(deps.fetch).not.toHaveBeenCalled();
  });

  test('keeps a partly unmapped report unread for a later retry', async () => {
    const { client, deps } = setup({
      importMappedAdsFromFile: jest.fn().mockResolvedValue({ importedShops: 1, unassignedRows: 1, complete: false }),
    });

    await expect(createAmazonAdsEmailImportService(deps).runOnce())
      .resolves.toEqual({ imported: 0, skipped: 0, pending: 1, failed: 0 });

    expect(client.messageFlagsAdd).not.toHaveBeenCalled();
  });

  test('leaves email unread when the import fails', async () => {
    const { client, deps } = setup({ importMappedAdsFromFile: jest.fn().mockRejectedValue(new Error('storage unavailable')) });

    await expect(createAmazonAdsEmailImportService(deps).runOnce())
      .resolves.toEqual({ imported: 0, skipped: 0, pending: 0, failed: 1 });

    expect(client.messageFlagsAdd).not.toHaveBeenCalled();
  });
});
