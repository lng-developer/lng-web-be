jest.mock('fs', () => ({ createReadStream: jest.fn(() => 'asset-stream') }));
jest.mock('stream/promises', () => ({ pipeline: jest.fn() }));
jest.mock('../../../src/shared/utils/objectId', () => ({ assertValidObjectId: jest.fn() }));
jest.mock('../../../src/modules/media/services/mediaAsset.service', () => ({
  getAuthorizedDownloadUrl: jest.fn(),
  withAuthorizedAssetLocalReadFile: jest.fn(),
}));

const { pipeline } = require('stream/promises');
const service = require('../../../src/modules/media/services/mediaAsset.service');
const controller = require('../../../src/modules/media/controllers/mediaAsset.controller');

test('does not fail when the client closes an asset download stream', async () => {
  const req = { auth: { accountId: 'account-1' }, params: { assetId: 'asset-1' }, query: {} };
  const res = {
    destroyed: true,
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  service.getAuthorizedDownloadUrl.mockResolvedValue(null);
  service.withAuthorizedAssetLocalReadFile.mockImplementation((_assetId, _auth, reader) => reader({
    mediaAsset: { originalFilename: 'file.png', mimeType: 'image/png', size: 5 },
    localPath: 'private/file.png',
  }));
  pipeline.mockRejectedValueOnce(Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }));

  await expect(controller.downloadAsset(req, res)).resolves.toBeUndefined();
});
