const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const repository = require('../repositories/customizationPayload.repository');
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
  const result = rawCustomization.provider === 'ETSY' || rawCustomization.variations || rawCustomization.personalization
    ? normalizeEtsyCustomization(rawCustomization)
    : normalizeAmazonCustomization(rawCustomization);
  const patch = {
    parsedData: result.parsedData,
    assets: result.assets,
    status: result.outcome,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    lastTriedAt: new Date(),
  };
  const updatedPayload = rawCustomization.provider === 'ETSY'
    ? await repository.updateEtsyRevision(payload._id, payload.__v || 0, patch)
    : await repository.updateParsedData(payload._id, result.parsedData, patch);

  if (!updatedPayload) {
    throw new AppError('Customization changed; retry parsing', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  await require('./customizationPayload.service').syncWorkbenchCustomization(updatedPayload);
  return updatedPayload;
}

module.exports = {
  parseForOrderItem,
};
