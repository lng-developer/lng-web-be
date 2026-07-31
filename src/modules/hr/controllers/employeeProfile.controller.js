const fs = require('fs');
const { pipeline } = require('stream/promises');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/employeeProfile.service');
const {
  completeMyPersonalProfileSchema,
  createProfileSchema,
  listProfilesSchema,
  profileDetailQuerySchema,
  updateProfileSchema,
  validate,
} = require('../validators/employeeProfile.validator');

function assertValid(schema, payload, options) {
  const { value, details } = validate(schema, payload, options);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

async function listProfiles(req, res) {
  const query = assertValid(listProfilesSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listProfiles(query, req.auth) });
}

async function createProfile(req, res) {
  const payload = assertValid(createProfileSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createProfile(payload, req.auth) });
}

async function getMyProfile(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.getMyProfile(req.auth) });
}

async function updateMyPersonalProfile(req, res) {
  const payload = assertValid(completeMyPersonalProfileSchema, req.body, { stripUnknown: false });
  res.status(httpStatus.OK).json({ success: true, data: await service.updateMyPersonalProfile(payload, req.auth) });
}

async function getProfile(req, res) {
  const query = assertValid(profileDetailQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getProfile(req.params.profileId, req.auth, query),
  });
}

async function uploadProfileAvatar(req, res) {
  if (!req.file) {
    throw new AppError('Avatar file is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.uploadProfileAvatar(req.params.profileId, req.file, req.auth),
  });
}

async function uploadMyProfileAvatar(req, res) {
  if (!req.file) {
    throw new AppError('Avatar file is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.uploadMyProfileAvatar(req.file, req.auth),
  });
}

async function streamProfileAvatar(res, readAvatar) {
  await readAvatar(async ({ mediaAsset, localPath }) => {
    res.setHeader('Content-Type', mediaAsset.mimeType || 'application/octet-stream');
    if (Number.isInteger(mediaAsset.size)) res.setHeader('Content-Length', mediaAsset.size);
    res.status(httpStatus.OK);
    await pipeline(fs.createReadStream(localPath), res);
  });
}

async function getProfileAvatar(req, res) {
  await streamProfileAvatar(res, (reader) => service.withProfileAvatar(
    req.params.profileId,
    req.auth,
    reader,
  ));
}

async function getMyProfileAvatar(req, res) {
  await streamProfileAvatar(res, (reader) => service.withMyProfileAvatar(req.auth, reader));
}

async function updateProfile(req, res) {
  const payload = assertValid(updateProfileSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateProfile(req.params.profileId, payload, req.auth) });
}

async function deleteProfile(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.deleteProfile(req.params.profileId, req.auth) });
}

async function restoreProfile(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.restoreProfile(req.params.profileId, req.auth) });
}

module.exports = {
  createProfile,
  deleteProfile,
  getMyProfile,
  getMyProfileAvatar,
  getProfile,
  getProfileAvatar,
  listProfiles,
  restoreProfile,
  updateMyPersonalProfile,
  updateProfile,
  uploadProfileAvatar,
  uploadMyProfileAvatar,
};
