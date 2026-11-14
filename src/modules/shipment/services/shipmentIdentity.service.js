const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');

function validationError(message, details) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
}

function deriveTrackingIdentity(submission = {}) {
  const vendor = submission.payloadSnapshot?.vendorProduct?.vendor || {};
  const provider = String(submission.provider || vendor.providerKey || vendor.code || '').trim().toUpperCase();
  const legacyMangoOrderId = provider === 'MANGOTEE'
    ? submission.payloadSnapshot?.orderItem?.externalOrderId
      || submission.payloadSnapshot?.orderItemSnapshot?.externalOrderId
      || submission.payloadSnapshot?.externalOrderId
    : null;
  const lngPortalOrderId = provider === 'LNG_GROUP'
    ? submission.payloadSnapshot?.orderItem?.externalOrderId
      || submission.payloadSnapshot?.orderItemSnapshot?.externalOrderId
      || submission.payloadSnapshot?.externalOrderId
    : null;
  const orderExternalOrderId = String(
    submission.payloadSnapshot?.orderSnapshot?.externalOrderId
    || submission.payloadSnapshot?.orderItemSnapshot?.externalOrderId
    || submission.payloadSnapshot?.orderItem?.externalOrderId
    || submission.payloadSnapshot?.externalOrderId
    || submission.externalOrderId
    || submission.orderExternalOrderId
    || ''
  ).trim();
  const requiredIdentity = {
    vendorId: String(vendor.id || vendor._id || submission.vendorId || ''),
    provider,
    vendorExternalOrderId: String(lngPortalOrderId || submission.vendorExternalOrderId || legacyMangoOrderId || '').trim(),
    shopId: String(submission.shopId || ''),
    orderId: String(submission.orderId || ''),
    orderItemId: String(submission.orderItemId || ''),
  };
  if (Object.values(requiredIdentity).some((value) => !value)) {
    throw validationError('Vendor tracking identity is incomplete');
  }
  const identity = {
    ...requiredIdentity,
  };
  if (orderExternalOrderId) {
    identity.orderExternalOrderId = orderExternalOrderId;
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
