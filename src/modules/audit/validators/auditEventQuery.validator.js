const Joi = require('joi');
const mongoose = require('mongoose');

const MAX_DATE_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const code = Joi.string().trim().uppercase().max(100).pattern(/^[A-Z][A-Z0-9_]*$/);
const identifier = Joi.string().trim().min(1).max(200);
const objectId = Joi.string().hex().length(24);
const cursor = Joi.string().max(500).custom((value, helpers) => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !mongoose.isObjectIdOrHexString(parsed.id)) return helpers.error('any.invalid');
    return { createdAt, id: new mongoose.Types.ObjectId(parsed.id) };
  } catch (_error) {
    return helpers.error('any.invalid');
  }
});

const listAuditEventsQuerySchema = Joi.object({
  actorAccountId: objectId,
  action: code,
  entityType: code,
  entityId: identifier,
  scopeType: code,
  scopeId: identifier,
  outcome: Joi.string().trim().uppercase().valid('SUCCEEDED', 'FAILED'),
  source: Joi.string().trim().uppercase().valid('HTTP', 'WORKER', 'SYSTEM', 'IMPORT'),
  requestId: identifier,
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  cursor,
  limit: Joi.number().integer().min(1).max(100).default(20),
}).custom((value, helpers) => {
  if (value.scopeId && !value.scopeType) return helpers.error('object.with', { main: 'scopeId', peer: 'scopeType' });
  if (value.dateFrom && value.dateTo) {
    const range = value.dateTo.getTime() - value.dateFrom.getTime();
    if (range < 0 || range > MAX_DATE_RANGE_MS) return helpers.error('date.range');
  }
  return value;
});

const auditEventParamsSchema = Joi.object({ eventId: objectId.required() });

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, convert: true, stripUnknown: true });
  if (!result.error) return { value: result.value };
  return { value: result.value, details: result.error.details.map((detail) => ({
    message: detail.message, path: detail.path, type: detail.type,
  })) };
}

module.exports = { auditEventParamsSchema, listAuditEventsQuerySchema, validate };
