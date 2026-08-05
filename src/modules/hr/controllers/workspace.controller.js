const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/workspace.service');
const { validate, workspaceQuerySchema } = require('../validators/workspace.validator');

function query(req) {
  const { value, details } = validate(workspaceQuerySchema, req.query);
  if (details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  return value;
}

async function getMyWorkspace(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.getMyWorkspace(query(req), req.auth) });
}

async function getTeamWorkspace(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.getTeamWorkspace(query(req), req.auth) });
}

module.exports = { getMyWorkspace, getTeamWorkspace };
