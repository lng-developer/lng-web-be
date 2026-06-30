const payloadService = require('./services/customizationPayload.service');
const parseService = require('./services/customizationParse.service');
const assetDownloadService = require('./services/customizationAssetDownload.service');
const zipInspectService = require('./services/customizationZipInspect.service');

module.exports = {
  createPendingPayload: payloadService.createPendingPayload,
  getByOrderItem: payloadService.getByOrderItem,
  markNeedsReview: payloadService.markNeedsReview,
  parseForOrderItem: parseService.parseForOrderItem,
  downloadAssetsForOrderItem: assetDownloadService.downloadAssetsForOrderItem,
  inspectDownloadedZipForOrderItem: zipInspectService.inspectDownloadedZipForOrderItem,
  inspectDownloadedZipForPayload: zipInspectService.inspectDownloadedZipForPayload,
  extractZipImagesForOrderItem: zipInspectService.extractZipImagesForOrderItem,
  extractZipImagesForPayload: zipInspectService.extractZipImagesForPayload,
  assertCustomizationReady: payloadService.assertCustomizationReady,
};
