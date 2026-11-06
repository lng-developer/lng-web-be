jest.mock('../../../src/modules/media/repositories/mediaAsset.repository');
jest.mock('../../../src/modules/media/services/wasabiStorage.service');

const repository = require('../../../src/modules/media/repositories/mediaAsset.repository');
const wasabi = require('../../../src/modules/media/services/wasabiStorage.service');
const { cleanupMultipartUploads } = require('../../../src/modules/media/scripts/cleanupMultipartUploads');

describe('cleanupMultipartUploads', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aborts a bounded batch of expired active uploads', async () => {
    repository.findExpiredUploads.mockResolvedValue([
      { _id: 'asset-1', providerAssetId: 'media/a.zip', uploadStatus: 'UPLOADING', metadata: { multipartUploadId: 'upload-1' } },
      { _id: 'asset-2', providerAssetId: 'media/b.psd', uploadStatus: 'UPLOADING', metadata: { multipartUploadId: 'upload-2' } },
    ]);
    repository.transitionUploadStatus.mockImplementation(async (id) => ({ _id: id, uploadStatus: 'ABORTED' }));

    await expect(cleanupMultipartUploads({ limit: 2, now: new Date('2026-08-06T00:00:00Z') }))
      .resolves.toEqual({ selected: 2, aborted: 2, failed: 0 });
    expect(repository.findExpiredUploads).toHaveBeenCalledWith(new Date('2026-08-06T00:00:00Z'), 2);
    expect(wasabi.abortMultipartUpload).toHaveBeenCalledTimes(2);
  });

  test('keeps failed aborts retryable', async () => {
    repository.findExpiredUploads.mockResolvedValue([
      { _id: 'asset-1', providerAssetId: 'media/a.zip', uploadStatus: 'UPLOADING', metadata: { multipartUploadId: 'upload-1' } },
    ]);
    wasabi.abortMultipartUpload.mockRejectedValue(new Error('temporary'));

    await expect(cleanupMultipartUploads({ limit: 100 })).resolves.toEqual({ selected: 1, aborted: 0, failed: 1 });
    expect(repository.transitionUploadStatus).not.toHaveBeenCalled();
  });

  test("marks NoSuchUpload as ABORTED with EXPIRED_NOT_FOUND", async () => {
    repository.findExpiredUploads.mockResolvedValue([
      { _id: "asset-1", providerAssetId: "media/a.zip", uploadStatus: "UPLOADING", metadata: { multipartUploadId: "upload-1" } },
    ]);
    const notFoundError = new Error("The specified multipart upload does not exist.");
    notFoundError.name = "NoSuchUpload";
    wasabi.abortMultipartUpload.mockRejectedValue(notFoundError);

    await expect(cleanupMultipartUploads({ limit: 100, now: new Date("2026-08-06T00:00:00Z") }))
      .resolves.toEqual({ selected: 1, aborted: 1, failed: 0 });
    expect(repository.transitionUploadStatus).toHaveBeenCalledWith("asset-1", "UPLOADING", "ABORTED", {
      "metadata.abortedAt": new Date("2026-08-06T00:00:00Z"),
      "metadata.abortReason": "EXPIRED_NOT_FOUND",
    });
  });
});
