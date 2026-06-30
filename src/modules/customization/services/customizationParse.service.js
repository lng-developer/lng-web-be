const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const repository = require('../repositories/customizationPayload.repository');
const { normalizeAmazonCustomization } = require('../parsers/amazonCustomization.parser');

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

async function parseForOrderItem(orderItemId) {
  const payload = await repository.findByOrderItem(orderItemId);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  const result = normalizeAmazonCustomization(payload.rawCustomization);
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

  return updatedPayload;
}

module.exports = {
  parseForOrderItem,
};
