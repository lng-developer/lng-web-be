const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const service = require('../services/extensionToken.service');
const {
  extensionTokenCreateSchema,
  extensionTokenIdSchema,
  extensionTokenListSchema,
  validate,
} = require('../validators/auth.validator');

function input(schema, value) {
  const result = validate(schema, value);
  if (result.details) {
    throw new AppError(
      'Validation failed',
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
      result.details,
    );
  }
  return result.value;
}

async function create(req, res) {
  const payload = input(extensionTokenCreateSchema, req.body);
  const data = await service.create({ ...payload, createdByAccountId: req.auth.accountId });
  res.status(201).json({ success: true, data });
}

async function list(req, res) {
  res.status(200).json({
    success: true,
    data: await service.list(input(extensionTokenListSchema, req.query)),
  });
}

async function revoke(req, res) {
  const token = await service.revoke(input(extensionTokenIdSchema, req.params).tokenId);
  if (!token) {
    throw new AppError(
      'Extension token not found',
      httpStatus.NOT_FOUND,
      true,
      errorCodes.RESOURCE_NOT_FOUND,
    );
  }
  res.status(200).json({ success: true, data: token });
}

module.exports = { create, list, revoke };
