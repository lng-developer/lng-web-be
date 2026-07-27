const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/announcement.service');
const {
  announcementParamsSchema,
  createAnnouncementSchema,
  listAnnouncementSchema,
  updateAnnouncementSchema,
  validate,
} = require('../validators/announcement.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  return value;
}

async function createAnnouncement(req, res) {
  const payload = assertValid(createAnnouncementSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createAnnouncement(payload, req.auth) });
}

async function listAnnouncements(req, res) {
  const query = assertValid(listAnnouncementSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listAnnouncements(query, req.auth) });
}

async function getAnnouncement(req, res) {
  const { id } = assertValid(announcementParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.getAnnouncement(id, req.auth) });
}

async function updateAnnouncement(req, res) {
  const { id } = assertValid(announcementParamsSchema, req.params);
  const payload = assertValid(updateAnnouncementSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateAnnouncement(id, payload, req.auth) });
}

async function deleteAnnouncement(req, res) {
  const { id } = assertValid(announcementParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.deleteAnnouncement(id, req.auth) });
}

module.exports = { createAnnouncement, deleteAnnouncement, getAnnouncement, listAnnouncements, updateAnnouncement };
