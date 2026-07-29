const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/staffProvisioning.service');
const { staffProvisioningSchema, validate } = require('../validators/staffProvisioning.validator');

function assertValid(payload) {
  const { value, details } = validate(staffProvisioningSchema, payload);
  if (details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  return value;
}

async function provisionStaff(req, res) {
  const payload = assertValid(req.body);
  const httpContext = {
    requestId: req.id,
    ipAddress: req.ip || null,
    userAgent: req.get('user-agent') || null,
  };
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.provisionStaff(payload, req.auth, httpContext),
  });
}

module.exports = { provisionStaff };
