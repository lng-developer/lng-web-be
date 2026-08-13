const fs = require('fs');
const { pipeline } = require('stream/promises');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const service = require('../services/mediaAsset.service');
const multipartUploadService = require('../services/multipartUpload.service');
const { toMediaAssetDto, toMediaAssetListDto } = require('../dtos/mediaAsset.dto');
const schemas = require('../validators/mediaAsset.validator');

function assertValid(schema, payload) {
  const { value, details } = schemas.validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

async function listAssets(req, res) {
  const query = assertValid(schemas.listSchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: toMediaAssetListDto(await service.listAssets(query)),
  });
}

async function uploadAsset(req, res) {
  const asset = await require('../public').storeUploadedFile(req.file, {
    source: 'MEDIA_UPLOAD', uploadedBy: req.auth?.accountId || null,
  });
  const dto = toMediaAssetDto(asset);

  res.location(`/api/media/assets/${dto.id}`);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: dto,
  });
}

async function initiateMultipartUpload(req, res) {
  const input = assertValid(schemas.initiateMultipartSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await multipartUploadService.initiateUpload(input, req.auth),
  });
}

async function presignMultipartParts(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  const input = assertValid(schemas.presignPartsSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: { parts: await multipartUploadService.presignParts(req.params.assetId, input.partNumbers, req.auth) },
  });
}

async function completeMultipartUpload(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  const input = assertValid(schemas.completeMultipartSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: toMediaAssetDto(await multipartUploadService.completeUpload(req.params.assetId, input.parts, req.auth)),
  });
}

async function abortMultipartUpload(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  res.status(httpStatus.OK).json({
    success: true,
    data: toMediaAssetDto(await multipartUploadService.abortUpload(req.params.assetId, req.auth)),
  });
}

async function getAsset(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  res.status(httpStatus.OK).json({
    success: true,
    data: toMediaAssetDto(await service.getAuthorizedAsset(req.params.assetId, req.auth)),
  });
}

async function downloadAsset(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
  try {
    const redirectUrl = await service.getAuthorizedDownloadUrl(req.params.assetId, req.auth, { disposition });
    if (redirectUrl) {
      res.redirect(redirectUrl);
      return;
    }
    await service.withAuthorizedAssetLocalReadFile(req.params.assetId, req.auth, async ({ mediaAsset, localPath }) => {
      const filename = encodeURIComponent(mediaAsset.originalFilename || 'asset.bin');
      res.setHeader('Content-Type', mediaAsset.mimeType || 'application/octet-stream');
      if (Number.isInteger(mediaAsset.size)) res.setHeader('Content-Length', mediaAsset.size);
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${filename}`);
      res.status(httpStatus.OK);
      await pipeline(fs.createReadStream(localPath), res);
    });
  } catch (error) {
    if ([
      'MEDIA_ASSET_NOT_FOUND',
      'MEDIA_ASSET_FILE_NOT_FOUND',
      'MEDIA_CLOUDINARY_DOWNLOAD_FAILED',
    ].includes(error.code)) {
      throw new AppError('Media asset file not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    throw error;
  }
}

module.exports = {
  abortMultipartUpload,
  completeMultipartUpload,
  downloadAsset,
  getAsset,
  initiateMultipartUpload,
  listAssets,
  presignMultipartParts,
  uploadAsset,
};
