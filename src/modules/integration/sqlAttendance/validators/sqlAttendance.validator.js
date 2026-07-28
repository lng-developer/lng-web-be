const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

function validateSync(req, _res, next) {
  const raw = req.body?.limit;
  if (raw === undefined) return next();
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    return next(new AppError(
      'limit must be an integer from 1 to 5000',
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
    ));
  }
  req.body.limit = limit;
  return next();
}

module.exports = { validateSync };
