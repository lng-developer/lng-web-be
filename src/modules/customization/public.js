const payloadService = require('./services/customizationPayload.service');
const parseService = require('./services/customizationParse.service');
const assetDownloadService = require('./services/customizationAssetDownload.service');
const zipInspectService = require('./services/customizationZipInspect.service');
const {
  toCustomizationPayloadDto,
  toOrderItemCustomizationViewDto,
} = require('./dtos/customizationPayload.dto');

async function getByOrderItemDto(orderItemId, authContext) {
  return toCustomizationPayloadDto(await payloadService.getByOrderItem(orderItemId, authContext));
}

async function getOrderItemCustomizationView(orderItemId, authContext) {
  return toOrderItemCustomizationViewDto(await payloadService.getByOrderItem(orderItemId, authContext));
}

async function listOrderItemCustomizationViews(orderItemIds = [], authContext) {
  return (await payloadService.listLatestByOrderItems(orderItemIds, authContext)).map(toOrderItemCustomizationViewDto);
}

module.exports = {
  createPendingPayload: payloadService.createPendingPayload,
  getByOrderItem: payloadService.getByOrderItem,
  getByOrderItemDto,
  getOrderItemCustomizationView,
  listOrderItemCustomizationViews,
  markNeedsReview: payloadService.markNeedsReview,
  parseForOrderItem: parseService.parseForOrderItem,
  downloadAssetsForOrderItem: assetDownloadService.downloadAssetsForOrderItem,
  inspectDownloadedZipForOrderItem: zipInspectService.inspectDownloadedZipForOrderItem,
  inspectDownloadedZipForPayload: zipInspectService.inspectDownloadedZipForPayload,
  extractZipImagesForOrderItem: zipInspectService.extractZipImagesForOrderItem,
  extractZipImagesForPayload: zipInspectService.extractZipImagesForPayload,
  assertCustomizationReady: payloadService.assertCustomizationReady,
};
