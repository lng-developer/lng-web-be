const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/customizationPayload.service');
const assetDownloadService = require('../services/customizationAssetDownload.service');
const zipInspectService = require('../services/customizationZipInspect.service');
const {
  toCustomizationPayloadDto,
  toPaginatedCustomizationPayloadDto,
} = require('../dtos/customizationPayload.dto');
const {
  createPendingPayloadSchema,
  payloadIdParamSchema,
  orderItemIdParamSchema,
  listPayloadsQuerySchema,
  needsReviewSchema,
  failedSchema,
  parsedSchema,
  downloadAssetsSchema,
  inspectZipSchema,
  validate,
} = require('../validators/customizationPayload.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

async function listPayloads(req, res) {
  const query = assertValid(listPayloadsQuerySchema, req.query);
  const result = await service.listPayloads(query, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toPaginatedCustomizationPayloadDto(result) });
}

async function getById(req, res) {
  const { payloadId } = assertValid(payloadIdParamSchema, req.params);
  const payload = await service.getById(payloadId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toCustomizationPayloadDto(payload) });
}

async function getByOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const payload = await service.getByOrderItem(orderItemId, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toCustomizationPayloadDto(payload) });
}

async function createPendingPayload(req, res) {
  const body = assertValid(createPendingPayloadSchema, req.body);
  const result = await service.createPendingPayload({
    ...body,
    createdBy: req.auth && req.auth.accountId,
  }, req.auth);

  res
    .status(result.created ? httpStatus.CREATED : httpStatus.OK)
    .json({
      success: true,
      data: {
        payload: toCustomizationPayloadDto(result.payload),
        created: result.created,
      },
    });
}

async function markNeedsReview(req, res) {
  const { payloadId } = assertValid(payloadIdParamSchema, req.params);
  const { reason } = assertValid(needsReviewSchema, req.body);
  const payload = await service.markNeedsReview(payloadId, reason, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toCustomizationPayloadDto(payload) });
}

async function markFailed(req, res) {
  const { payloadId } = assertValid(payloadIdParamSchema, req.params);
  const body = assertValid(failedSchema, req.body);
  const payload = await service.markFailed(payloadId, body, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toCustomizationPayloadDto(payload) });
}

async function markParsed(req, res) {
  const { payloadId } = assertValid(payloadIdParamSchema, req.params);
  const { parsedData } = assertValid(parsedSchema, req.body);
  const payload = await service.markParsed(payloadId, parsedData, req.auth);

  res.status(httpStatus.OK).json({ success: true, data: toCustomizationPayloadDto(payload) });
}

async function downloadAssetsForOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const body = assertValid(downloadAssetsSchema, req.body || {});
  const result = await assetDownloadService.downloadAssetsForOrderItem(orderItemId, body, req.auth);

  res.status(httpStatus.OK).json({
    success: true,
    data: {
      payloadId: result.payloadId,
      downloadedCount: result.downloadedCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      assets: result.assets,
      payload: toCustomizationPayloadDto(result.payload),
    },
  });
}

async function inspectZipForOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const body = assertValid(inspectZipSchema, req.body || {});
  const result = await zipInspectService.inspectDownloadedZipForOrderItem(orderItemId, body, req.auth);

  res.status(httpStatus.OK).json({
    success: true,
    data: {
      payloadId: result.payloadId,
      inspectedAssetId: result.inspectedAssetId,
      zipInspectionStatus: result.zipInspectionStatus,
      fileCount: result.fileCount,
      totalUncompressedBytes: result.totalUncompressedBytes,
      entries: result.entries,
      warnings: result.warnings,
      errors: result.errors,
      payload: toCustomizationPayloadDto(result.payload),
    },
  });
}

async function extractZipImagesForOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemIdParamSchema, req.params);
  const body = assertValid(inspectZipSchema, req.body || {});
  const result = await zipInspectService.extractZipImagesForOrderItem(orderItemId, body, req.auth);

  res.status(httpStatus.OK).json({
    success: true,
    data: {
      payloadId: result.payloadId,
      sourceAssetId: result.sourceAssetId,
      extractedCount: result.extractedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      extractedImages: result.extractedImages,
      payload: toCustomizationPayloadDto(result.payload),
    },
  });
}

module.exports = {
  listPayloads,
  getById,
  getByOrderItem,
  createPendingPayload,
  markNeedsReview,
  markFailed,
  markParsed,
  downloadAssetsForOrderItem,
  inspectZipForOrderItem,
  extractZipImagesForOrderItem,
};
