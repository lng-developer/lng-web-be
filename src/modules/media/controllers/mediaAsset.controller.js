const { Readable } = require('stream');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/mediaAsset.service');
const { toMediaAssetDto } = require('../dtos/mediaAsset.dto');

function validationError(message, details) {
  throw new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
}

async function uploadAsset(req, res) {
  const file = req.file;
  if (!file) validationError('file is required', { field: 'file' });

  const asset = await service.storeAsset({
    stream: Readable.from(file.buffer),
    filename: file.originalname,
    mimeType: file.mimetype || null,
    metadata: {
      source: 'MEDIA_UPLOAD',
      uploadedBy: req.auth?.accountId || null,
    },
    maxBytes: file.size,
  });

  res.status(httpStatus.CREATED).json({
    success: true,
    data: toMediaAssetDto(asset),
  });
}

module.exports = {
  uploadAsset,
};
