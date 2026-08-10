jest.mock('../../../src/modules/media/repositories/mediaAsset.repository');
jest.mock('../../../src/modules/media/services/wasabiStorage.service');

const repository = require('../../../src/modules/media/repositories/mediaAsset.repository');
const wasabi = require('../../../src/modules/media/services/wasabiStorage.service');
const service = require('../../../src/modules/media/services/multipartUpload.service');

describe('multipartUpload service', () => {
  const auth = { accountId: '660000000000000000000901' };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/lng_test';
    process.env.WASABI_ENDPOINT = 'https://s3.us-east-1.wasabisys.com';
    process.env.WASABI_REGION = 'us-east-1';
    process.env.WASABI_BUCKET = 'private-designs';
    process.env.WASABI_ACCESS_KEY_ID = 'test-key';
    process.env.WASABI_SECRET_ACCESS_KEY = 'test-secret';
  });

  test.each(['template.psd', 'package.zip'])('initiates %s without receiving file bytes', async (filename) => {
    wasabi.createMultipartUpload.mockResolvedValue({ uploadId: 'upload-1' });
    repository.create.mockImplementation(async (asset) => ({ _id: 'asset-1', ...asset }));

    const result = await service.initiateUpload({
      filename,
      mimeType: 'application/octet-stream',
      size: 100 * 1024 * 1024,
      assetPurpose: 'DESIGN_PACKAGE',
    }, auth);

    expect(result).toEqual(expect.objectContaining({ assetId: 'asset-1', totalParts: 2 }));
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'wasabi',
      uploadStatus: 'UPLOADING',
      size: 100 * 1024 * 1024,
      metadata: expect.objectContaining({ uploadedBy: auth.accountId, multipartUploadId: 'upload-1' }),
    }));
  });

  test.each([
    [{ filename: 'template.rar', size: 100 }, 'MEDIA_FILE_TYPE_INVALID'],
    [{ filename: 'template.psd', size: 0 }, 'MEDIA_FILE_TOO_LARGE'],
    [{ filename: 'template.psd', size: (2 * 1024 * 1024 * 1024) + 1 }, 'MEDIA_FILE_TOO_LARGE'],
  ])('rejects invalid initiate input %#', async (input, code) => {
    await expect(service.initiateUpload({
      mimeType: 'application/octet-stream', assetPurpose: 'DESIGN_PACKAGE', ...input,
    }, auth)).rejects.toMatchObject({ code });
    expect(wasabi.createMultipartUpload).not.toHaveBeenCalled();
  });

  test('presigns only valid requested parts owned by the initiator', async () => {
    repository.findById.mockResolvedValue({
      _id: 'asset-1', provider: 'wasabi', providerAssetId: 'media/key.zip', uploadStatus: 'UPLOADING',
      metadata: { uploadedBy: auth.accountId, multipartUploadId: 'upload-1', totalParts: 3, expiresAt: new Date(Date.now() + 60000) },
    });
    wasabi.presignUploadPart.mockImplementation(async ({ partNumber }) => `url-${partNumber}`);

    await expect(service.presignParts('asset-1', [1, 3], auth)).resolves.toEqual([
      { partNumber: 1, url: 'url-1' }, { partNumber: 3, url: 'url-3' },
    ]);
  });

  test('rejects expired or foreign upload sessions', async () => {
    repository.findById.mockResolvedValue({
      _id: 'asset-1', provider: 'wasabi', uploadStatus: 'UPLOADING',
      metadata: { uploadedBy: 'another-account', multipartUploadId: 'upload-1', totalParts: 3, expiresAt: new Date(Date.now() - 1) },
    });

    await expect(service.presignParts('asset-1', [1], auth)).rejects.toMatchObject({ statusCode: 403 });
  });

  test.each([
    ['template.psd', Buffer.from([0x38, 0x42, 0x50, 0x53])],
    ['package.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])('completes and verifies %s without downloading the object', async (filename, signature) => {
    const asset = {
      _id: 'asset-1', originalFilename: filename, size: 100, provider: 'wasabi',
      providerAssetId: `media/${filename}`, uploadStatus: 'UPLOADING',
      metadata: { uploadedBy: auth.accountId, multipartUploadId: 'upload-1', totalParts: 2, expiresAt: new Date(Date.now() + 60000) },
    };
    repository.findById.mockResolvedValue(asset);
    repository.transitionUploadStatus
      .mockResolvedValueOnce({ ...asset, uploadStatus: 'VERIFYING' })
      .mockResolvedValueOnce({ ...asset, uploadStatus: 'READY' });
    wasabi.headObject.mockResolvedValue({ ContentLength: 100 });
    wasabi.readObjectRange.mockResolvedValue(signature);

    await expect(service.completeUpload('asset-1', [
      { partNumber: 2, etag: 'etag-2' }, { partNumber: 1, etag: 'etag-1' },
    ], auth)).resolves.toMatchObject({ uploadStatus: 'READY' });
    expect(wasabi.completeMultipartUpload).toHaveBeenCalled();
    expect(wasabi.readObjectRange).toHaveBeenCalledWith({ key: asset.providerAssetId, start: 0, end: 7 });
  });

  test('returns an already ready asset when complete is retried', async () => {
    repository.findById.mockResolvedValue({ _id: 'asset-1', uploadStatus: 'READY', metadata: { uploadedBy: auth.accountId } });
    await expect(service.completeUpload('asset-1', [{ partNumber: 1, etag: 'etag' }], auth))
      .resolves.toMatchObject({ uploadStatus: 'READY' });
    expect(wasabi.completeMultipartUpload).not.toHaveBeenCalled();
  });

  test('aborts active uploads idempotently', async () => {
    const asset = {
      _id: 'asset-1', providerAssetId: 'media/key.zip', uploadStatus: 'UPLOADING',
      metadata: { uploadedBy: auth.accountId, multipartUploadId: 'upload-1', expiresAt: new Date(Date.now() + 60000) },
    };
    repository.findById.mockResolvedValue(asset);
    repository.transitionUploadStatus.mockResolvedValue({ ...asset, uploadStatus: 'ABORTED' });
    await expect(service.abortUpload('asset-1', auth)).resolves.toMatchObject({ uploadStatus: 'ABORTED' });
    expect(wasabi.abortMultipartUpload).toHaveBeenCalledWith({ key: 'media/key.zip', uploadId: 'upload-1' });
  });
});
