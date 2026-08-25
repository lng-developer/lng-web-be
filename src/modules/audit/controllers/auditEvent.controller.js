const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/auditEvent.service');
const mongoIndexUsageSnapshotService = require('../services/mongoIndexUsageSnapshot.service');
const {
  auditEventParamsSchema,
  exportAuditEventsQuerySchema,
  listMongoIndexUsageSnapshotsQuerySchema,
  listAuditEventsQuerySchema,
  validate,
} = require('../validators/auditEventQuery.validator');

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

async function exportEventsCsv(req, res) {
  const query = assertValid(exportAuditEventsQuerySchema, req.query);
  const csv = await service.exportEventsCsv(query, req.auth);
  res
    .status(httpStatus.OK)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="audit-events.csv"')
    .send(csv);
}

async function getEvent(req, res) {
  const { eventId } = assertValid(auditEventParamsSchema, req.params);
  res.status(httpStatus.OK).json(response(await service.getEvent(eventId, req.auth)));
}

async function listMongoIndexUsageSnapshots(req, res) {
  const query = assertValid(listMongoIndexUsageSnapshotsQuerySchema, req.query);
  res.status(httpStatus.OK).json(response(await mongoIndexUsageSnapshotService.listRecent(query)));
}

module.exports = { exportEventsCsv, getEvent, listEvents, listMongoIndexUsageSnapshots };
