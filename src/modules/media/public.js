const mediaAssetService = require('./services/mediaAsset.service');

const publicPort = {
  storeAsset: mediaAssetService.storeAsset,
  withAssetLocalReadFile: mediaAssetService.withAssetLocalReadFile,
  assertMediaAssetExists: mediaAssetService.assertMediaAssetExists,
};

module.exports = publicPort;
