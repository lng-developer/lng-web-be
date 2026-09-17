const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { financePermissions } = require('../constants/finance.constants');
const { toCashFlowDto } = require('../dtos/financeCashFlow.dto');
const repository = require('../repositories/financeCashFlow.repository');
const financeAccess = require('./financeAccess.service');

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

async function getCashFlow(query = {}, authContext = {}) {
  const shopIds = financeAccess.accessibleShopIds(authContext, financePermissions.READ);
  if (shopIds !== null && !shopIds.length) throw forbidden();
  return toCashFlowDto(await repository.getCashFlow({
    ...query,
    ...(shopIds === null ? {} : { shopIds }),
  }));
}

module.exports = { getCashFlow };
