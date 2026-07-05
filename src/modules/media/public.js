const mediaAssetService = require('./services/mediaAsset.service');

const publicPort = {
  getAsset: mediaAssetService.getAsset,
  readAssetBuffer: mediaAssetService.readAssetBuffer,
  storeAsset: mediaAssetService.storeAsset,
  withAssetLocalReadFile: mediaAssetService.withAssetLocalReadFile,
  assertMediaAssetExists: mediaAssetService.assertMediaAssetExists,
};

module.exports = publicPort;
