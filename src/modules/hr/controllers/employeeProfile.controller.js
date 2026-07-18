const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/employeeProfile.service');
const {
  createProfileSchema,
  listProfilesSchema,
  profileDetailQuerySchema,
  updateProfileSchema,
  validate,
} = require('../validators/employeeProfile.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
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

async function getProfile(req, res) {
  const query = assertValid(profileDetailQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getProfile(req.params.profileId, req.auth, query),
  });
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
  getProfile,
  listProfiles,
  restoreProfile,
  updateProfile,
};
