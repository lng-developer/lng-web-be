const authPublic = require('../../auth/public');
const financePublic = require('../../finance/public');
const orderPublic = require('../../order/public');
const productionPublic = require('../../production/public');
const shipmentPublic = require('../../shipment/public');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { reportPermissions } = require('../constants/report.constants');
const {
  toAdsChannelPerformanceDto,
  toAdsDailyDto,
  toAdsSellerAttributionDto,
  toBuyerInsightsDto,
  toFinanceBySellerDto,
  toFinanceByTeamDto,
  toFinanceDailyDto,
  toFinanceDailyProfitDto,
  toOperationsOverviewDto,
  toVendorPerformanceDto,
} = require('../dtos/report.dto');

const SHOP_SCOPE_TYPE = 'shop';

function hasGlobalReportRead(authContext = {}) {
  return (authContext.permissions || []).includes(reportPermissions.READ);
}

function reportShopScopes(authContext = {}) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(reportPermissions.READ)
    ))
    .map((scope) => String(scope.scopeId)))];
}

function applyReportScope(query = {}, authContext = {}) {
  if (hasGlobalReportRead(authContext)) return query;
  const shopIds = reportShopScopes(authContext);
  if (query.shopId) {
    return authPublic.canAccessScope(authContext, reportPermissions.READ, {
      scopeType: SHOP_SCOPE_TYPE,
      scopeId: query.shopId,
    }) ? query : null;
  }
  if (shopIds.length === 0) return null;
  return { ...query, shopIds };
}

function systemContext(authContext = {}) {
  return {
    system: true,
    source: 'REPORT',
    accountId: authContext.accountId || null,
  };
}

async function summarizeProduction(scopedQuery, authContext) {
  const { shopIds, ...query } = scopedQuery;
  if (!shopIds || shopIds.length === 0) {
    return productionPublic.summarizeTasks(query, systemContext(authContext));
  }

  const summaries = await Promise.all(shopIds.map((shopId) => (
    productionPublic.summarizeTasks({ ...query, shopId }, systemContext(authContext))
  )));

  return summaries.reduce((result, summary) => {
    Object.entries(summary || {}).forEach(([key, value]) => {
      if (key === 'blockers') return;
      result[key] = (result[key] || 0) + (Number(value) || 0);
    });
    Object.entries(summary?.blockers || {}).forEach(([key, value]) => {
      result.blockers[key] = (result.blockers[key] || 0) + (Number(value) || 0);
    });
    return result;
  }, { blockers: {} });
}

async function getFinanceDaily(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return [];
  return (await financePublic.summarizeDaily(scopedQuery, systemContext(authContext))).map(toFinanceDailyDto);
}

async function getBuyerInsights(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return toBuyerInsightsDto();
  return toBuyerInsightsDto(
    await orderPublic.summarizeBuyerInsights(scopedQuery, systemContext(authContext)),
  );
}

function channelKey(row = {}) {
  return [row.salesChannelCode || '', row.marketplaceCode || '', row.currency || ''].join('|');
}

async function getAdsChannelPerformance(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return [];
  const [adsRows, buyerRows] = await Promise.all([
    financePublic.summarizeAdsByChannel(scopedQuery, systemContext(authContext)),
    orderPublic.summarizeNewBuyersByChannel(scopedQuery, systemContext(authContext)),
  ]);
  const buyersByChannel = new Map(
    (buyerRows || []).map((row) => [channelKey(row), Number(row.newBuyerCount || 0)]),
  );
  return (adsRows || []).map((row) => toAdsChannelPerformanceDto({
    ...row,
    newBuyerCount: buyersByChannel.get(channelKey(row)) || 0,
  }));
}

async function getAdsSellerAttribution(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return [];
  return (await financePublic.summarizeAdsBySeller(scopedQuery, systemContext(authContext)))
    .map(toAdsSellerAttributionDto);
}

async function getAdsDaily(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return [];
  return (await financePublic.summarizeAdsDaily(scopedQuery, systemContext(authContext)))
    .map(toAdsDailyDto);
}

async function getFinanceDailyProfit(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return [];
  return (await financePublic.summarizeDailyProfit(scopedQuery, systemContext(authContext)))
    .map(toFinanceDailyProfitDto);
}

async function getFinanceBySeller(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return [];
  return (await financePublic.summarizeBySeller(scopedQuery, systemContext(authContext))).map(toFinanceBySellerDto);
}

async function getFinanceByTeam(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return [];
  return (await financePublic.summarizeByTeam(scopedQuery, systemContext(authContext))).map(toFinanceByTeamDto);
}

async function getVendorPerformance(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) {
    return {
      items: [],
      total: 0,
      page: Number(query.page) || 1,
      limit: Math.min(Math.max(Number(query.limit) || 100, 1), 500),
    };
  }
  const page = await vendorSubmissionPublic.summarizePerformancePage(scopedQuery, systemContext(authContext));
  const rows = page.items || [];
  const orderItemIds = [
    ...new Set((rows || []).flatMap((row) => (row.orderItemIds || []).map(String).filter(Boolean))),
  ];
  const shippedByOrderItemId = await shipmentPublic.summarizeShippedByOrderItemIds(
    orderItemIds,
    systemContext(authContext),
  );

  return {
    ...page,
    items: (rows || []).map((row) => {
      const submitted = Number(row.submittedCount || 0);
      const failed = Number(row.failedCount || 0);
      const denominator = submitted + failed;
      const shippedCount = (row.orderItemIds || []).reduce(
        (total, orderItemId) => total + Number(shippedByOrderItemId[String(orderItemId)] || 0),
        0,
      );
      return toVendorPerformanceDto({
        vendorId: row._id,
        vendorCode: row.vendorCode,
        vendorName: row.vendorName,
        readyCount: row.readyCount,
        submittedCount: submitted,
        failedCount: failed,
        cancelledCount: row.cancelledCount,
        shippedCount,
        successRateBps: denominator > 0 ? Math.round((submitted / denominator) * 10000) : null,
        avgProcessingHours: row.avgProcessingMs
          ? Math.round((Number(row.avgProcessingMs) / 3600000) * 100) / 100
          : null,
      });
    }),
  };
}

function productionByStatus(summary = {}) {
  return {
    BLOCKED: summary.blocked || 0,
    NEED_SCALE: summary.needScale || 0,
    QC_PENDING: summary.qcPending || 0,
    READY_TO_SEND_VENDOR: summary.readyToSendVendor || 0,
  };
}

function vendorSubmissionStatusTotals(rows = []) {
  return rows.reduce((result, row) => {
    result.READY += row.readyCount || 0;
    result.SUBMITTED += row.submittedCount || 0;
    result.FAILED += row.failedCount || 0;
    result.CANCELLED += row.cancelledCount || 0;
    return result;
  }, {
    READY: 0,
    SUBMITTED: 0,
    FAILED: 0,
    CANCELLED: 0,
  });
}

async function getOperationsOverview(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return toOperationsOverviewDto();

  const [orderItemsByStatus, production, vendorRows, shipmentSummary] = await Promise.all([
    orderPublic.summarizeOrderItems(scopedQuery, systemContext(authContext)),
    summarizeProduction(scopedQuery, authContext),
    vendorSubmissionPublic.summarizePerformance(scopedQuery, systemContext(authContext)),
    shipmentPublic.summarizeShipments(scopedQuery, systemContext(authContext)),
  ]);

  return toOperationsOverviewDto({
    orderItemsByStatus,
    productionByStatus: productionByStatus(production),
    productionBlockers: production.blockers || {},
    vendorSubmissionsByStatus: vendorSubmissionStatusTotals(vendorRows),
    shipmentsByStatus: shipmentSummary.byStatus || {},
  });
}

module.exports = {
  getAdsChannelPerformance,
  getAdsDaily,
  getAdsSellerAttribution,
  getBuyerInsights,
  getFinanceBySeller,
  getFinanceByTeam,
  getFinanceDaily,
  getFinanceDailyProfit,
  getOperationsOverview,
  getVendorPerformance,
};
