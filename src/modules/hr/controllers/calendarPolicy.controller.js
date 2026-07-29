const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/calendarPolicy.service');
const schemas = require('../validators/calendarPolicy.validator');

function assertValid(schema, payload) {
  const { value, details } = schemas.validate(schema, payload);
  if (details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  return value;
}

async function listHolidays(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.listHolidays(assertValid(schemas.holidayListSchema, req.query), req.auth) });
}

async function getHoliday(req, res) {
  const { id } = assertValid(schemas.idParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.getHoliday(id, req.auth) });
}

async function createHoliday(req, res) {
  const payload = assertValid(schemas.createHolidaySchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createHoliday(payload, req.auth) });
}

async function updateHoliday(req, res) {
  const { id } = assertValid(schemas.idParamsSchema, req.params);
  const payload = assertValid(schemas.updateHolidaySchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateHoliday(id, payload, req.auth) });
}

async function deleteHoliday(req, res) {
  const { id } = assertValid(schemas.idParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.deleteHoliday(id, req.auth) });
}

async function listHolidayRange(req, res) {
  const query = assertValid(schemas.holidayRangeSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listHolidayRange(query, req.auth) });
}

async function checkHoliday(req, res) {
  const query = assertValid(schemas.holidayCheckSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.checkHoliday(query, req.auth) });
}

async function summarizeHolidays(req, res) {
  const { year } = assertValid(schemas.yearParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.summarizeHolidays(year, req.auth) });
}

async function bulkImportHolidays(req, res) {
  const payload = assertValid(schemas.bulkImportHolidaySchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.bulkImportHolidays(payload, req.auth) });
}

async function listHolidayTemplates(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.listHolidayTemplates(req.auth) });
}

async function listRotations(req, res) {
  const query = assertValid(schemas.rotationListSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listRotations(query, req.auth) });
}

async function generateRotations(req, res) {
  const payload = assertValid(schemas.generateRotationSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.generateRotations(payload, req.auth) });
}

async function listRotationMatrix(req, res) {
  const query = assertValid(schemas.rotationMatrixSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listRotationMatrix(query, req.auth) });
}

async function createRotation(req, res) {
  const payload = assertValid(schemas.createRotationSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createRotation(payload, req.auth) });
}

async function updateRotation(req, res) {
  const { id } = assertValid(schemas.idParamsSchema, req.params);
  const payload = assertValid(schemas.updateRotationSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateRotation(id, payload, req.auth) });
}

async function deleteRotation(req, res) {
  const { id } = assertValid(schemas.idParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.deleteRotation(id, req.auth) });
}

async function deleteTeamRotations(req, res) {
  const { teamId } = assertValid(schemas.teamParamsSchema, req.params);
  const query = assertValid(schemas.deleteTeamRotationsSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.deleteTeamRotations(teamId, query, req.auth) });
}

module.exports = {
  bulkImportHolidays,
  checkHoliday,
  createRotation,
  createHoliday,
  deleteHoliday,
  deleteRotation,
  deleteTeamRotations,
  generateRotations,
  getHoliday,
  listHolidayRange,
  listHolidayTemplates,
  listHolidays,
  listRotationMatrix,
  listRotations,
  summarizeHolidays,
  updateHoliday,
  updateRotation,
};
