const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const repository = require('../repositories/customizationPayload.repository');
const payloadService = require('./customizationPayload.service');
const { normalizeAmazonCustomization } = require('../parsers/amazonCustomization.parser');
const { normalizeEtsyCustomization } = require('../parsers/etsyCustomization.parser');

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function parseForOrderItem(orderItemId) {
  const payload = await repository.findByOrderItem(orderItemId);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  const rawCustomization = payload.rawCustomization || {};
  const result = rawCustomization.variations || rawCustomization.personalization
    ? normalizeEtsyCustomization(rawCustomization)
    : normalizeAmazonCustomization(rawCustomization);
  const updatedPayload = await repository.updateParsedData(payload._id, result.parsedData, {
    assets: result.assets,
    status: result.outcome,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    lastTriedAt: new Date(),
  });

  if (!updatedPayload) {
    throw notFound('Customization payload not found');
  }

  await payloadService.syncWorkbenchCustomization(updatedPayload);
  return updatedPayload;
}

module.exports = {
  parseForOrderItem,
};
