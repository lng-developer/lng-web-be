jest.mock('../../../modules/customization/repositories/customizationPayload.repository', () => ({
  findByOrderItem: jest.fn(),
  updateAssets: jest.fn(),
}));

jest.mock('../../../shared/network/safeRemoteFetchStream', () => ({
  safeRemoteFetchStream: jest.fn(),
  redactUrl: jest.fn((url) => {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/[REDACTED_PATH]${parsed.search ? '?[REDACTED]' : ''}`;
  }),
}));

jest.mock('../../../modules/media/public', () => ({
  storeAsset: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const repository = require('../../../modules/customization/repositories/customizationPayload.repository');
const mediaPublic = require('../../../modules/media/public');
const { safeRemoteFetchStream } = require('../../../shared/network/safeRemoteFetchStream');
const service = require('../../../modules/customization/services/customizationAssetDownload.service');
const { customizationStatuses } = require('../../../modules/customization/constants/customizationStatuses');
const { customizationAssetTypes } = require('../../../modules/customization/constants/customizationAssetTypes');

describe('customizationAssetDownload.service', () => {
  const payloadId = '660000000000000000000601';
  const orderItemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';
  const sourceUrl = 'https://zme-caps.amazon.com/t/file.zip?token=secret';

  beforeEach(() => {
    jest.clearAllMocks();
    repository.updateAssets.mockImplementation(async (id, assets) => ({
      _id: id,
      orderItemId,
      shopId,
      status: customizationStatuses.PARSED,
      assets,
    }));
  });

  function mockPayload(assets) {
    repository.findByOrderItem.mockResolvedValue({
      _id: payloadId,
      orderItemId,
      shopId,
      status: customizationStatuses.PARSED,
      assets,
    });
  }

  test('downloads pending CUSTOMIZED_URL via stream and leaves payload status parsed', async () => {
    mockPayload([
      { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl, status: customizationStatuses.PENDING, metadata: {} },
      { type: customizationAssetTypes.CUSTOMIZED_PAGE, sourceUrl: 'https://a.co/page', status: customizationStatuses.PENDING, metadata: {} },
    ]);
    safeRemoteFetchStream.mockResolvedValue({
      stream: Readable.from([Buffer.from('zip')]),
      metadata: {
        contentType: 'application/zip',
        classification: 'zip',
        finalUrlRedacted: 'https://zme-caps.amazon.com/t/file.zip?[REDACTED]',
      },
    });
    mediaPublic.storeAsset.mockResolvedValue({
      _id: '660000000000000000000901',
      sha256: 'a'.repeat(64),
      size: 3,
      mimeType: 'application/zip',
    });

    const result = await service.downloadAssetsForOrderItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] });

    expect(safeRemoteFetchStream).toHaveBeenCalledWith(sourceUrl, expect.objectContaining({
      timeoutMs: 15000,
      maxBytes: 10485760,
      maxRedirects: 3,
    }));
    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      stream: expect.any(Object),
      mimeType: 'application/zip',
      sourceUrlRedacted: 'https://zme-caps.amazon.com/t/file.zip?[REDACTED]',
      sourceUrlHash: expect.any(String),
      maxBytes: 10485760,
    }));
    expect(repository.updateAssets).toHaveBeenCalledWith(payloadId, [
      expect.objectContaining({
        type: customizationAssetTypes.CUSTOMIZED_URL,
        status: customizationStatuses.DOWNLOADED,
        assetId: '660000000000000000000901',
        metadata: expect.objectContaining({
          sha256: 'a'.repeat(64),
          size: 3,
          mimeType: 'application/zip',
          classification: 'zip',
          downloadedAt: expect.any(Date),
        }),
      }),
      expect.objectContaining({
        type: customizationAssetTypes.CUSTOMIZED_PAGE,
        status: customizationStatuses.PENDING,
      }),
    ]);
    expect(result).toMatchObject({
      payloadId,
      downloadedCount: 1,
      failedCount: 0,
      skippedCount: 1,
    });
    expect(result.payload.status).toBe(customizationStatuses.PARSED);
  });

  test('skips DOWNLOADED and FAILED unless retryFailed is true', async () => {
    mockPayload([
      { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl, status: customizationStatuses.DOWNLOADED, metadata: {} },
      { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl: 'https://example.test/failed.zip', status: customizationStatuses.FAILED, metadata: {} },
    ]);

    const result = await service.downloadAssetsForOrderItem(orderItemId);

    expect(safeRemoteFetchStream).not.toHaveBeenCalled();
    expect(repository.updateAssets).not.toHaveBeenCalled();
    expect(result).toMatchObject({ downloadedCount: 0, failedCount: 0, skippedCount: 2 });
  });

  test('retryFailed retries FAILED assets', async () => {
    mockPayload([
      { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl, status: customizationStatuses.FAILED, metadata: {} },
    ]);
    safeRemoteFetchStream.mockResolvedValue({
      stream: Readable.from([Buffer.from('zip')]),
      metadata: { contentType: 'application/zip', classification: 'zip', finalUrlRedacted: 'https://example.test/file.zip' },
    });
    mediaPublic.storeAsset.mockResolvedValue({ _id: '660000000000000000000901', sha256: 'b'.repeat(64), size: 3, mimeType: 'application/zip' });

    const result = await service.downloadAssetsForOrderItem(orderItemId, { retryFailed: true });

    expect(safeRemoteFetchStream).toHaveBeenCalledTimes(1);
    expect(result.downloadedCount).toBe(1);
  });

  test('failed download marks only the asset failed and keeps payload parsed', async () => {
    mockPayload([
      { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl, status: customizationStatuses.PENDING, metadata: {} },
    ]);
    safeRemoteFetchStream.mockRejectedValue(Object.assign(new Error('too large'), { code: 'REMOTE_STREAM_TOO_LARGE' }));

    const result = await service.downloadAssetsForOrderItem(orderItemId, { idleTimeoutMs: 25 });

    expect(safeRemoteFetchStream).toHaveBeenCalledWith(sourceUrl, expect.objectContaining({
      idleTimeoutMs: 25,
    }));
    expect(repository.updateAssets).toHaveBeenCalledWith(payloadId, [
      expect.objectContaining({
        status: customizationStatuses.FAILED,
        metadata: expect.objectContaining({
          errorCode: 'REMOTE_STREAM_TOO_LARGE',
          errorMessage: 'too large',
          failedAt: expect.any(Date),
        }),
      }),
    ]);
    expect(result.failedCount).toBe(1);
    expect(result.payload.status).toBe(customizationStatuses.PARSED);
  });

  test('idle timeout failure is recorded on the asset', async () => {
    mockPayload([
      { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl, status: customizationStatuses.PENDING, metadata: {} },
    ]);
    safeRemoteFetchStream.mockRejectedValue(Object.assign(new Error('Remote stream idle timeout'), {
      code: 'REMOTE_STREAM_IDLE_TIMEOUT',
    }));

    const result = await service.downloadAssetsForOrderItem(orderItemId);

    expect(repository.updateAssets).toHaveBeenCalledWith(payloadId, [
      expect.objectContaining({
        status: customizationStatuses.FAILED,
        metadata: expect.objectContaining({
          errorCode: 'REMOTE_STREAM_IDLE_TIMEOUT',
          errorMessage: 'Remote stream idle timeout',
        }),
      }),
    ]);
    expect(result.failedCount).toBe(1);
  });

  test('service imports only media public port across module boundary', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../modules/customization/services/customizationAssetDownload.service.js'), 'utf8');

    expect(source).toContain("require('../../media/public')");
    expect(source).not.toMatch(/media\/(models|repositories|services|controllers|routes)\//);
    expect(source).not.toMatch(/order\/public|catalog\/|mapping\/|vendorSubmission\/|shipment\//);
  });
});
