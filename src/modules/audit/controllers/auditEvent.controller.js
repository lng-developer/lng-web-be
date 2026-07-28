const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/auditEvent.service');
const { auditEventParamsSchema, listAuditEventsQuerySchema, validate } = require('../validators/auditEventQuery.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  return value;
}

function response(data) {
  return Object.assign(Object.create(null), { success: true, data });
}

async function listEvents(req, res) {
  const query = assertValid(listAuditEventsQuerySchema, req.query);
  res.status(httpStatus.OK).json(response(await service.listEvents(query, req.auth)));
}

async function getEvent(req, res) {
  const { eventId } = assertValid(auditEventParamsSchema, req.params);
  res.status(httpStatus.OK).json(response(await service.getEvent(eventId, req.auth)));
}

module.exports = { getEvent, listEvents };
