const fs = require('fs');
const { pipeline } = require('stream/promises');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const service = require('../services/mediaAsset.service');
const { toMediaAssetDto } = require('../dtos/mediaAsset.dto');

async function uploadAsset(req, res) {
  const asset = await require('../public').storeUploadedFile(req.file, {
    source: 'MEDIA_UPLOAD', uploadedBy: req.auth?.accountId || null,
  });

  res.status(httpStatus.CREATED).json({
    success: true,
    data: toMediaAssetDto(asset),
  });
}

async function getAsset(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  res.status(httpStatus.OK).json({
    success: true,
    data: toMediaAssetDto(await service.getAsset(req.params.assetId)),
  });
}

async function downloadAsset(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  try {
    await service.withAssetLocalReadFile(req.params.assetId, async ({ mediaAsset, localPath }) => {
      const filename = encodeURIComponent(mediaAsset.originalFilename || 'asset.bin');
      res.setHeader('Content-Type', mediaAsset.mimeType || 'application/octet-stream');
      if (Number.isInteger(mediaAsset.size)) res.setHeader('Content-Length', mediaAsset.size);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.status(httpStatus.OK);
      await pipeline(fs.createReadStream(localPath), res);
    });
  } catch (error) {
    if (['MEDIA_ASSET_NOT_FOUND', 'MEDIA_ASSET_FILE_NOT_FOUND'].includes(error.code)) {
      throw new AppError('Media asset file not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    throw error;
  }
}

module.exports = {
  downloadAsset,
  getAsset,
  uploadAsset,
};
