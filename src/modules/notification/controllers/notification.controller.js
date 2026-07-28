const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/notification.service');
const schemas = require('../validators/notification.validator');

function assertValid(schema, payload) {
  const { value, details } = schemas.validate(schema, payload);
  if (details) {
    throw new AppError(
      'Validation failed',
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
      details,
    );
  }
  return value;
}

async function listInbox(req, res) {
  const query = assertValid(schemas.listSchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listInbox(req.auth.accountId, query),
  });
}

async function getUnreadCount(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getUnreadCount(req.auth.accountId),
  });
}

async function markRead(req, res) {
  const { id } = assertValid(schemas.idParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markRead(id, req.auth.accountId),
  });
}

async function markAllRead(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markAllRead(req.auth.accountId),
  });
}

module.exports = {
  getUnreadCount,
  listInbox,
  markAllRead,
  markRead,
};
