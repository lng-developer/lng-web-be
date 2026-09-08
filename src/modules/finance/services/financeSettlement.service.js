const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { financePermissions } = require('../constants/finance.constants');
const financeAccess = require('./financeAccess.service');
const repository = require('../repositories/financeImport.repository');
const {
  toSettlementDetailDto,
  toSettlementListDto,
} = require('../dtos/financeSettlement.dto');

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function notFound() {
  return new AppError('Settlement not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function assertRead(authContext = {}) {
  if (!financeAccess.hasGlobal(authContext, financePermissions.READ)) throw forbidden();
}

async function listSettlements(query = {}, authContext = {}) {
  assertRead(authContext);
  return toSettlementListDto(await repository.listSettlements(query));
}

async function getSettlement(settlementId, query = {}, authContext = {}) {
  assertRead(authContext);
  const settlement = await repository.getSettlement(settlementId);
  if (!settlement) throw notFound();
  const ledger = await repository.listSettlementLedgerLines({
    ...query,
    settlementId: settlement.settlementId,
    shopId: settlement.shopId,
    salesChannelCode: settlement.salesChannelCode,
    marketplaceCode: settlement.marketplaceCode,
  });
  return toSettlementDetailDto({ settlement, ledger });
}

module.exports = { getSettlement, listSettlements };
