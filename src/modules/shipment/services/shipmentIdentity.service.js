const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');

function validationError(message, details) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
}

function deriveTrackingIdentity(submission = {}) {
  const vendor = submission.payloadSnapshot?.vendorProduct?.vendor || {};
  const identity = {
    vendorId: String(vendor.id || vendor._id || ''),
    provider: String(submission.provider || vendor.providerKey || '').trim().toUpperCase(),
    vendorExternalOrderId: String(submission.vendorExternalOrderId || '').trim(),
    shopId: String(submission.shopId || ''),
    orderId: String(submission.orderId || ''),
    orderItemId: String(submission.orderItemId || ''),
  };
  if (Object.values(identity).some((value) => !value)) {
    throw validationError('Vendor tracking identity is incomplete');
  }
  return identity;
}

function assertMatchingTrackingIdentity(identity, input = {}) {
  const provider = String(input.provider || '').trim().toUpperCase();
  const externalOrderId = String(input.externalOrderId || '').trim();
  if (provider && provider !== identity.provider) {
    throw validationError('Tracking provider does not match vendor submission');
  }
  if (externalOrderId && externalOrderId !== identity.vendorExternalOrderId) {
    throw validationError('Tracking external order ID does not match vendor submission');
  }
  return identity;
}

module.exports = { assertMatchingTrackingIdentity, deriveTrackingIdentity };
