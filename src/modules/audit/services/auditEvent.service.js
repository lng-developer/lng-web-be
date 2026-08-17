const repository = require('../repositories/auditEvent.repository');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { toAuditEventDto, toAuditEventListDto } = require('../dtos/auditEvent.dto');
const { validateAndSanitizeAuditEvent } = require('../validators/auditEvent.validator');

const READ_PERMISSION = 'AUDIT:READ';

function getAuthPublic() {
  return require('../../auth/public');
}

function isGlobalReader(authContext = {}, authPublic = getAuthPublic()) {
  return (authContext.permissions || []).includes(READ_PERMISSION)
    || Boolean(authPublic.isSuperAdmin?.(authContext));
}

function readableScopes(authContext = {}) {
  const authPublic = getAuthPublic();
  if (isGlobalReader(authContext, authPublic)) return null;
  return (authContext.scopes || [])
    .filter((scope) => scope.scopeType && scope.scopeId !== undefined && scope.scopeId !== null)
    .filter((scope) => authPublic.canAccessScope(authContext, READ_PERMISSION, {
      scopeType: scope.scopeType, scopeId: scope.scopeId,
    }))
    .map((scope) => ({
      scopeType: String(scope.scopeType).toUpperCase(), scopeId: String(scope.scopeId),
    }));
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function notFound() {
  return new AppError('Audit event not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function record(payload, { session } = {}) {
  const value = validateAndSanitizeAuditEvent(payload);
  return toAuditEventDto(await repository.upsertByDeduplicationKey(value, { session }));
}

async function listEvents(query, authContext) {
  const scopes = readableScopes(authContext);
  if (scopes && query.scopeId && !scopes.some((scope) => (
    scope.scopeType === query.scopeType && scope.scopeId === query.scopeId
  ))) throw forbidden();
  return toAuditEventListDto(await repository.list(query, scopes));
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

async function exportEventsCsv(query, authContext) {
  const result = await listEvents({ ...query, limit: query.limit || 5000 }, authContext);
  return csvRows([
    [
      'Event ID', 'Created at', 'Actor', 'Actor email', 'Action', 'Entity type',
      'Entity ID', 'Scope type', 'Scope ID', 'Outcome', 'Source', 'Request ID',
      'IP address',
    ],
    ...result.items.map((event) => [
      event.id,
      event.createdAt,
      event.actorLabel || event.actorEmployeeCode || event.actorType,
      event.actorEmail,
      event.action,
      event.entityType,
      event.entityId,
      event.scopeType,
      event.scopeId,
      event.outcome,
      event.source,
      event.requestId,
      event.ipAddress,
    ]),
  ]);
}

async function getEvent(eventId, authContext) {
  const event = await repository.findById(eventId, readableScopes(authContext));
  if (!event) throw notFound();
  return toAuditEventDto(event);
}

module.exports = { exportEventsCsv, getEvent, listEvents, record };
