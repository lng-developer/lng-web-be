const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/attendance.service');
const {
  adjustAttendanceSchema,
  attendanceEventSchema,
  attendanceIdParamsSchema,
  listAttendanceSchema,
  listMyAttendanceSchema,
  validate,
} = require('../validators/attendance.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

async function checkIn(req, res) {
  const payload = assertValid(attendanceEventSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.checkIn(req.auth, payload) });
}

async function checkOut(req, res) {
  const payload = assertValid(attendanceEventSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.checkOut(req.auth, payload) });
}

async function listAttendance(req, res) {
  const query = assertValid(listAttendanceSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listAttendance(query, req.auth) });
}

async function listMyAttendance(req, res) {
  const query = assertValid(listMyAttendanceSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listAttendance({ ...query, own: true }, req.auth) });
}

async function adjustAttendance(req, res) {
  const { attendanceId } = assertValid(attendanceIdParamsSchema, req.params);
  const payload = assertValid(adjustAttendanceSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.adjustAttendance(attendanceId, payload, req.auth) });
}

module.exports = { adjustAttendance, checkIn, checkOut, listAttendance, listMyAttendance };
