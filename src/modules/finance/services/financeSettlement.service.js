const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const auditPublic = require('../../audit/public');
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

function assertSettlementAccess(settlement, query = {}) {
  if (Array.isArray(query.shopIds) && !query.shopIds.includes(String(settlement.shopId))) {
    throw notFound();
  }
}

async function listSettlements(query = {}, authContext = {}) {
  const scopedQuery = financeAccess.settlementScopedQuery(query, authContext, financePermissions.READ) || query;
  if (Array.isArray(scopedQuery.shopIds) && !scopedQuery.shopIds.length) throw forbidden();
  return toSettlementListDto(await repository.listSettlements(scopedQuery));
}

async function getSettlement(settlementId, query = {}, authContext = {}) {
  const scopedQuery = financeAccess.settlementScopedQuery(query, authContext, financePermissions.READ) || query;
  if (Array.isArray(scopedQuery.shopIds) && !scopedQuery.shopIds.length) throw forbidden();
  const settlement = await repository.getSettlement(settlementId);
  if (!settlement) throw notFound();
  assertSettlementAccess(settlement, scopedQuery);
  const ledger = await repository.listSettlementLedgerLines({
    ...scopedQuery,
    settlementId: settlement.settlementId,
    shopId: settlement.shopId,
    salesChannelCode: settlement.salesChannelCode,
    marketplaceCode: settlement.marketplaceCode,
  });
  return toSettlementDetailDto({ settlement, ledger });
}

async function reconcileSettlement(settlementId, input, authContext = {}, httpContext = {}) {
  const scopedQuery = financeAccess.settlementScopedQuery({}, authContext, financePermissions.WRITE) || {};
  if (Array.isArray(scopedQuery.shopIds) && !scopedQuery.shopIds.length) throw forbidden();
  const settlement = await repository.getSettlement(settlementId);
  if (!settlement) throw notFound();
  assertSettlementAccess(settlement, scopedQuery);
  const ledger = await repository.listSettlementLedgerLines({ ...scopedQuery, settlementId: settlement.settlementId });
  const summary = ledger.summary || {};
  const variance = (settlement.totalAmount ?? settlement.netSettlementAmount ?? 0) - (summary.netAmount || 0);
  const unlinkedCount = Math.max((summary.lineCount || 0) - (summary.linkedCount || 0), 0);
  if (input.status === 'RECONCILED' && (variance !== 0 || unlinkedCount)) {
    throw new AppError('Settlement has unresolved variance or unlinked rows', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }
  const reconciliation = {
    reconciliationStatus: input.status,
    reconciliationNote: input.note || null,
    reconciledAt: new Date(),
    reconciledByAccountId: authContext.accountId || null,
  };
  const updated = await repository.updateSettlementReconciliation(settlementId, reconciliation);
  await auditPublic.record({ actorType: 'ACCOUNT', actorAccountId: authContext.accountId || null, actorSnapshot: {}, action: `FINANCE_SETTLEMENT_${input.status}`, entityType: 'MARKETPLACE_SETTLEMENT', entityId: String(settlementId), scopeType: 'SHOP', scopeId: String(settlement.shopId), outcome: 'SUCCEEDED', source: 'HTTP', requestId: httpContext.requestId || null, ipAddress: httpContext.ipAddress || null, userAgent: httpContext.userAgent || null, changes: null, metadata: { settlementId: settlement.settlementId, variance, unlinkedCount }, deduplicationKey: `finance-settlement:${settlementId}:${input.status}` }, {});
  return toSettlementDetailDto({ settlement: updated, ledger });
}

module.exports = { getSettlement, listSettlements, reconcileSettlement };

