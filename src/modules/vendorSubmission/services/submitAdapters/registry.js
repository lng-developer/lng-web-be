const merchize = require('./merchize.adapter');
const printway = require('./printway.adapter');
const lenful = require('./lenful.adapter');
const merchfox = require('./merchfox.adapter');
const lngGroup = require('./lngGroup.adapter');
const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

const adapters = new Map([
  [merchize.provider, merchize],
  [printway.provider, printway],
  [lenful.provider, lenful],
  [merchfox.provider, merchfox],
  [lngGroup.provider, lngGroup],
]);

function getAdapter(provider) {
  const key = String(provider || '').trim().toUpperCase();
  const adapter = adapters.get(key);
  if (!adapter) {
    throw new AppError('Unsupported vendor submit provider', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, {
      provider,
    });
  }
  return adapter;
}

module.exports = {
  getAdapter,
};
