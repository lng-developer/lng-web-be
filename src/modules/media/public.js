const mediaAssetService = require('./services/mediaAsset.service');

const publicPort = {
  discardUnattachedAsset: mediaAssetService.discardUnattachedAsset,
  findAssetIdsByOriginalFilename: mediaAssetService.findAssetIdsByOriginalFilename,
  getAsset: mediaAssetService.getAsset,
  getAssetsByIds: mediaAssetService.getAssetsByIds,
  getStorageProvider: mediaAssetService.getStorageProvider,
  readAssetBuffer: mediaAssetService.readAssetBuffer,
  storeAsset: mediaAssetService.storeAsset,
  withAssetLocalReadFile: mediaAssetService.withAssetLocalReadFile,
  assertMediaAssetExists: mediaAssetService.assertMediaAssetExists,
};

module.exports = publicPort;
