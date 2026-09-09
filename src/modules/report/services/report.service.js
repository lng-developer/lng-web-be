const authPublic = require('../../auth/public');
const financePublic = require('../../finance/public');
const hrPublic = require('../../hr/public');
const organizationPublic = require('../../organization/public');
const orderPublic = require('../../order/public');
const productionPublic = require('../../production/public');
const shopPublic = require('../../shop/public');
const shipmentPublic = require('../../shipment/public');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { reportPermissions } = require('../constants/report.constants');
const {
  toAdsChannelPerformanceDto,
  toAdsDailyDto,
  toAdsSellerAttributionDto,
  toAdsSellerDailyDto,
  toBuyerInsightsDto,
  toFinanceBySellerDto,
  toFinanceCoverageDto,
  toFinanceSellerDailyDto,
  toFinanceByTeamDto,
  toFinanceDailyDto,
  toFinanceDailyProfitDto,
  toFinanceOrderProfitabilityDto,
  toOperationsOverviewDto,
  toVendorPerformanceDto,
} = require('../dtos/report.dto');

const SHOP_SCOPE_TYPE = 'shop';

function hasGlobalReportRead(authContext = {}) {
  return (authContext.permissions || []).includes(reportPermissions.READ);
}

function reportAccessConditions(authContext = {}) {
  return (authContext.scopes || [])
    .filter((scope) => (scope.permissions || []).includes(reportPermissions.READ))
    .flatMap((scope) => {
      if (scope.scopeType === 'shop' && scope.scopeId) return [{ shopId: String(scope.scopeId) }];
      if (scope.scopeType === 'department' && scope.scopeId) return [{ departmentId: String(scope.scopeId) }];
      if (scope.scopeType === 'team' && scope.scopeId) return [{ teamId: String(scope.scopeId) }];
      if (scope.scopeType === 'own' && authContext.accountId) {
        return [{ sellerAccountId: String(authContext.accountId) }];
      }
      return [];
    })
    .filter(
      (condition, index, all) =>
        index === all.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(condition)),
    );
}

function applyReportScope(query = {}, authContext = {}, { financeDimensions = false } = {}) {
  if (hasGlobalReportRead(authContext)) return query;
  const conditions = reportAccessConditions(authContext);
  if (financeDimensions) {
    if (!conditions.length) return null;
    const shopIds = conditions.map((condition) => condition.shopId).filter(Boolean);
    if (conditions.length === shopIds.length) {
      if (
        query.shopId &&
        !authPublic.canAccessScope(authContext, reportPermissions.READ, {
          scopeType: SHOP_SCOPE_TYPE,
          scopeId: query.shopId,
        })
      )
        return null;
      return { ...query, shopIds };
    }
    return { ...query, accessOr: conditions };
  }
  const shopIds = conditions.map((condition) => condition.shopId).filter(Boolean);
  if (query.shopId) {
    return authPublic.canAccessScope(authContext, reportPermissions.READ, {
      scopeType: SHOP_SCOPE_TYPE,
      scopeId: query.shopId,
    })
      ? query
      : null;
  }
  if (shopIds.length === 0) return null;
  return { ...query, shopIds };
}

function systemContext(authContext = {}) {
  return { system: true, source: 'REPORT', accountId: authContext.accountId || null };
}

async function resolveScopedAdsQuery(scopedQuery, authContext = {}) {
  if (!scopedQuery || hasGlobalReportRead(authContext) || !scopedQuery.accessOr) return scopedQuery;
  const { accessOr, ...query } = scopedQuery;
  const shopIds = accessOr.map((condition) => condition.shopId).filter(Boolean);
  const teamIds = accessOr.map((condition) => condition.teamId).filter(Boolean);
  const departmentIds = accessOr.map((condition) => condition.departmentId).filter(Boolean);
  const accountIds = accessOr.map((condition) => condition.sellerAccountId).filter(Boolean);
  const departmentTeams = await Promise.all(
    departmentIds.map((departmentId) => organizationPublic.listTeamsByDepartment(departmentId)),
  );
  const scopedTeamIds = [
    ...new Set([
      ...teamIds,
      ...departmentTeams
        .flat()
        .map((team) => team.id)
        .filter(Boolean),
    ]),
  ];
  const [teamProfiles, ownProfiles] = await Promise.all([
    scopedTeamIds.length ? hrPublic.listAssignableProfiles({ teamIds: scopedTeamIds, limit: 1000 }) : [],
    Promise.all(accountIds.map((accountId) => hrPublic.getEmployeeProfileByAccountId(accountId))),
  ]);
  const sellerEmployeeCodes = [
    ...new Set([...teamProfiles, ...ownProfiles].map((profile) => profile?.employeeCode).filter(Boolean)),
  ];
  const hasSellerScope = scopedTeamIds.length > 0 || accountIds.length > 0;
  const adsAccessOr = [...shopIds.map((shopId) => ({ shopId })), ...(hasSellerScope ? [{ sellerEmployeeCodes }] : [])];
  return adsAccessOr.length ? { ...query, adsAccessOr } : null;
}

function sellerPerformanceKey(row = {}) {
  return [row.sellerEmployeeCode || 'UNASSIGNED', row.currency || 'USD'].join('|');
}

function sellerDailyKey(row = {}) {
  return [row.date || '', row.sellerEmployeeCode || 'UNASSIGNED', row.currency || 'USD'].join('|');
}

function mergeSellerPerformanceWithAds(sellerRows = [], adsRows = [], { includeAdOnly = false } = {}) {
  const rows = new Map((sellerRows || []).map((row) => [sellerPerformanceKey(row), { ...row }]));
  (adsRows || []).forEach((adsRow) => {
    const key = sellerPerformanceKey(adsRow);
    const current = rows.get(key);
    if (!current && !includeAdOnly) return;
    const row = current || {
      sellerEmployeeCode: adsRow.sellerEmployeeCode || 'UNASSIGNED',
      sellerAccountId: null,
      sellerName: null,
      currency: adsRow.currency || 'USD',
      itemCount: 0,
      revenueAmount: 0,
      baseCostAmount: 0,
      grossProfitAmount: null,
      operatingCostAmount: 0,
      operatingCostDays: 0,
      netProfitAmount: null,
      netMarginBps: null,
      grossMarginBps: null,
      missingCostCount: 0,
    };
    const adSpendAmount = Number(adsRow.spendAmount || 0);
    const netProfitAmount =
      row.grossProfitAmount === null || row.grossProfitAmount === undefined
        ? null
        : Number(row.netProfitAmount ?? row.grossProfitAmount) - adSpendAmount;
    rows.set(key, {
      ...row,
      adSpendAmount: Number(row.adSpendAmount || 0) + adSpendAmount,
      netProfitAmount,
      netMarginBps:
        netProfitAmount !== null && row.revenueAmount > 0
          ? Math.round((netProfitAmount / row.revenueAmount) * 10000)
          : null,
    });
  });
  return [...rows.values()].sort((left, right) =>
    sellerPerformanceKey(left).localeCompare(sellerPerformanceKey(right)),
  );
}

function teamPerformanceKey(row = {}) {
  return [row.teamId || 'UNASSIGNED', row.currency || 'USD'].join('|');
}

async function getTeamBySellerEmployeeCode(adsRows = []) {
  const employeeCodes = [
    ...new Set((adsRows || []).map((row) => row.sellerEmployeeCode).filter((code) => code && code !== 'UNASSIGNED')),
  ];
  if (!employeeCodes.length) return new Map();

  const profiles = await hrPublic.listEmployeeProfilesByEmployeeCodes(employeeCodes);
  const organizations = await organizationPublic.listAccountOrganizationSummaries(
    profiles.map((profile) => profile.accountId).filter(Boolean),
  );
  const organizationByAccountId = new Map(
    organizations.map((organization) => [String(organization.accountId), organization]),
  );
  return new Map(
    profiles
      .map((profile) => [profile.employeeCode, organizationByAccountId.get(String(profile.accountId))])
      .filter(([, organization]) => organization?.team?.id),
  );
}

function mergeTeamPerformanceWithAds(teamRows = [], adsRows = [], teamBySellerCode = new Map()) {
  const rows = new Map((teamRows || []).map((row) => [teamPerformanceKey(row), { ...row }]));
  const sellersByTeam = new Map();
  (adsRows || []).forEach((adsRow) => {
    const organization = teamBySellerCode.get(adsRow.sellerEmployeeCode);
    if (!organization?.team?.id) return;
    const key = teamPerformanceKey({ teamId: organization.team.id, currency: adsRow.currency });
    const current = rows.get(key) || {
      teamId: organization.team.id,
      teamName: organization.team.name,
      teamCode: organization.team.code,
      departmentId: organization.department?.id || null,
      departmentName: organization.department?.name || null,
      departmentCode: organization.department?.code || null,
      currency: adsRow.currency || 'USD',
      itemCount: 0,
      revenueAmount: 0,
      baseCostAmount: 0,
      grossProfitAmount: null,
      operatingCostAmount: 0,
      operatingCostDays: 0,
      netProfitAmount: null,
      netMarginBps: null,
      grossMarginBps: null,
      missingCostCount: 0,
      activeSellerCount: 0,
    };
    const adSpendAmount = Number(adsRow.spendAmount || 0);
    const netProfitAmount =
      current.grossProfitAmount === null || current.grossProfitAmount === undefined
        ? null
        : Number(current.netProfitAmount ?? current.grossProfitAmount) - adSpendAmount;
    rows.set(key, {
      ...current,
      adSpendAmount: Number(current.adSpendAmount || 0) + adSpendAmount,
      netProfitAmount,
      netMarginBps:
        netProfitAmount !== null && current.revenueAmount > 0
          ? Math.round((netProfitAmount / current.revenueAmount) * 10000)
          : null,
    });
    if (!sellersByTeam.has(key)) sellersByTeam.set(key, new Set());
    sellersByTeam.get(key).add(adsRow.sellerEmployeeCode);
  });
  return [...rows.entries()]
    .map(([key, row]) => ({
      ...row,
      activeSellerCount: Math.max(Number(row.activeSellerCount || 0), sellersByTeam.get(key)?.size || 0),
    }))
    .sort((left, right) => teamPerformanceKey(left).localeCompare(teamPerformanceKey(right)));
}
async function summarizeProduction(scopedQuery, authContext) {
  const { shopIds, ...query } = scopedQuery;
  if (!shopIds || shopIds.length === 0) {
    return productionPublic.summarizeTasks(query, systemContext(authContext));
  }

  const summaries = await Promise.all(
    shopIds.map((shopId) => productionPublic.summarizeTasks({ ...query, shopId }, systemContext(authContext))),
  );

  return summaries.reduce(
    (result, summary) => {
      Object.entries(summary || {}).forEach(([key, value]) => {
        if (key === 'blockers') return;
        result[key] = (result[key] || 0) + (Number(value) || 0);
      });
      Object.entries(summary?.blockers || {}).forEach(([key, value]) => {
        result.blockers[key] = (result.blockers[key] || 0) + (Number(value) || 0);
      });
      return result;
    },
    { blockers: {} },
  );
}

async function getFinanceDaily(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext, { financeDimensions: true });
  const result = scopedQuery
    ? (await financePublic.summarizeDaily(scopedQuery, systemContext(authContext))).map(toFinanceDailyDto)
    : [];
  return result;
}

async function getFinanceCoverage(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext, { financeDimensions: true });
  const result = scopedQuery ? await financePublic.summarizeQuality(scopedQuery, systemContext(authContext)) : [];
  return result.map(toFinanceCoverageDto);
}

async function getBuyerInsights(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) return toBuyerInsightsDto();
  return toBuyerInsightsDto(await orderPublic.summarizeBuyerInsights(scopedQuery, systemContext(authContext)));
}

function channelKey(row = {}) {
  return [row.salesChannelCode || '', row.marketplaceCode || '', row.currency || ''].join('|');
}

async function getAdsChannelPerformance(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  if (!scopedQuery) {
    return [];
  }
  const [adsRows, buyerRows] = await Promise.all([
    financePublic.summarizeAdsByChannel(scopedQuery, systemContext(authContext)),
    orderPublic.summarizeNewBuyersByChannel(scopedQuery, systemContext(authContext)),
  ]);
  const buyersByChannel = new Map((buyerRows || []).map((row) => [channelKey(row), Number(row.newBuyerCount || 0)]));
  const result = (adsRows || []).map((row) =>
    toAdsChannelPerformanceDto({ ...row, newBuyerCount: buyersByChannel.get(channelKey(row)) || 0 }),
  );
  return result;
}

async function getAdsSellerAttribution(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  const result = scopedQuery
    ? (await financePublic.summarizeAdsBySeller(scopedQuery, systemContext(authContext))).map(toAdsSellerAttributionDto)
    : [];
  return result;
}

async function getAdsDaily(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  const result = scopedQuery
    ? (await financePublic.summarizeAdsDaily(scopedQuery, systemContext(authContext))).map(toAdsDailyDto)
    : [];
  return result;
}

async function getAdsSellerDaily(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext, { financeDimensions: true });
  const adsQuery = await resolveScopedAdsQuery(scopedQuery, authContext);
  if (!adsQuery) return [];
  const rows = await financePublic.summarizeAdsSellerDaily(adsQuery, systemContext(authContext));
  const employeeCodes = [
    ...new Set(rows.map((row) => row.sellerEmployeeCode).filter((code) => code && code !== 'UNASSIGNED')),
  ];
  const profiles = await hrPublic.listEmployeeProfilesByEmployeeCodes(employeeCodes);
  const sellerNameByCode = new Map(profiles.map((profile) => [profile.employeeCode, profile.fullName || null]));
  return rows.map((row) =>
    toAdsSellerDailyDto({ ...row, sellerName: sellerNameByCode.get(row.sellerEmployeeCode) || null }),
  );
}

async function getFinanceDailyProfit(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext);
  const result = scopedQuery
    ? (await financePublic.summarizeDailyProfit(scopedQuery, systemContext(authContext))).map(toFinanceDailyProfitDto)
    : [];
  return result;
}

async function getFinanceOrderProfitability(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext, { financeDimensions: true });
  if (!scopedQuery) return { items: [], pagination: { total: 0, page: 1, limit: 20 }, summaryByCurrency: [] };
  const result = await financePublic.summarizeOrderProfitability(scopedQuery, systemContext(authContext));
  return { ...result, items: (result.items || []).map(toFinanceOrderProfitabilityDto) };
}

async function getFinanceBySeller(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext, { financeDimensions: true });
  if (!scopedQuery) {
    return [];
  }
  const adsQuery = await resolveScopedAdsQuery(scopedQuery, authContext);
  const canReadAdsForScope = Boolean(adsQuery);
  const [sellerRows, adsRows] = await Promise.all([
    financePublic.summarizeBySeller(scopedQuery, systemContext(authContext)),
    canReadAdsForScope ? financePublic.summarizeAdsBySeller(adsQuery, systemContext(authContext)) : Promise.resolve([]),
  ]);
  const result = mergeSellerPerformanceWithAds(sellerRows, adsRows, { includeAdOnly: canReadAdsForScope }).map(
    toFinanceBySellerDto,
  );
  return result;
}

async function getFinanceSellerDaily(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext, { financeDimensions: true });
  if (!scopedQuery) return [];
  const adsQuery = await resolveScopedAdsQuery(scopedQuery, authContext);
  const canReadAdsForScope = Boolean(adsQuery);
  const [sellerRows, adsRows] = await Promise.all([
    financePublic.summarizeSellerDaily(scopedQuery, systemContext(authContext)),
    canReadAdsForScope
      ? financePublic.summarizeAdsSellerDaily(adsQuery, systemContext(authContext))
      : Promise.resolve([]),
  ]);
  const rows = new Map((sellerRows || []).map((row) => [sellerDailyKey(row), { ...row, adSpendAmount: 0 }]));
  (adsRows || []).forEach((adsRow) => {
    const key = sellerDailyKey(adsRow);
    const current = rows.get(key);
    if (!current) return;
    const adSpendAmount = Number(adsRow.adSpendAmount ?? adsRow.spendAmount ?? 0);
    const netProfitAmount =
      current.grossProfitAmount === null || current.grossProfitAmount === undefined
        ? null
        : Number(
            current.netProfitAmount ?? Number(current.grossProfitAmount) - Number(current.operatingCostAmount || 0),
          ) - adSpendAmount;
    const partialNetProfitAmount =
      current.partialNetProfitAmount === null || current.partialNetProfitAmount === undefined
        ? null
        : Number(current.partialNetProfitAmount) - Math.round(
            (adSpendAmount * Number(current.partialRevenueAmount || 0)) / Number(current.revenueAmount || 1),
          );
    rows.set(key, {
      ...current,
      adSpendAmount,
      netProfitAmount,
      ...(partialNetProfitAmount === null ? {} : { partialNetProfitAmount }),
      netMarginBps:
        netProfitAmount !== null && current.revenueAmount > 0
          ? Math.round((netProfitAmount / current.revenueAmount) * 10000)
          : null,
    });
  });
  return [...rows.values()]
    .sort((left, right) => sellerDailyKey(left).localeCompare(sellerDailyKey(right)))
    .map(toFinanceSellerDailyDto);
}

async function getFinanceByTeam(query = {}, authContext) {
  const scopedQuery = applyReportScope(query, authContext, { financeDimensions: true });
  if (!scopedQuery) {
    return [];
  }
  const adsQuery = await resolveScopedAdsQuery(scopedQuery, authContext);
  const canReadAdsForScope = Boolean(adsQuery);
  const [teamRows, adsRows] = await Promise.all([
    financePublic.summarizeByTeam(scopedQuery, systemContext(authContext)),
    canReadAdsForScope ? financePublic.summarizeAdsBySeller(adsQuery, systemContext(authContext)) : Promise.resolve([]),
  ]);
  const result = mergeTeamPerformanceWithAds(
    teamRows,
    adsRows,
    canReadAdsForScope ? await getTeamBySellerEmployeeCode(adsRows) : new Map(),
  ).map(toFinanceByTeamDto);
  return result;
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
  return rows.reduce(
    (result, row) => {
      result.READY += row.readyCount || 0;
      result.SUBMITTED += row.submittedCount || 0;
      result.FAILED += row.failedCount || 0;
      result.CANCELLED += row.cancelledCount || 0;
      return result;
    },
    { READY: 0, SUBMITTED: 0, FAILED: 0, CANCELLED: 0 },
  );
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

async function getFilterOptions(authContext = {}) {
  const scopedQuery = applyReportScope({}, authContext, { financeDimensions: true });
  if (!scopedQuery) {
    return { channels: [], marketplaces: [], sellers: [], teams: [], departments: [], shops: [] };
  }
  const options = await financePublic.listFilterOptions(scopedQuery, systemContext(authContext));
  const shopIds = (options.shops || []).map((shop) => String(shop.id)).filter(Boolean);
  const shops = shopIds.length ? await shopPublic.findByIds(shopIds) : [];
  const shopById = new Map(shops.map((shop) => [String(shop.id || shop._id), shop]));
  return {
    ...options,
    shops: shopIds.map((id) => ({ id, name: shopById.get(id)?.name || null, code: shopById.get(id)?.code || null })),
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function statusRows(title, rows = {}) {
  return [[title], ['Status', 'Count'], ...Object.entries(rows)];
}

async function exportReportCsv(query = {}, authContext) {
  const [daily, sellers, teams, channels, operations, vendors] = await Promise.all([
    hasGlobalReportRead(authContext) ? getFinanceDailyProfit(query, authContext) : getFinanceDaily(query, authContext),
    getFinanceBySeller(query, authContext),
    getFinanceByTeam(query, authContext),
    getAdsChannelPerformance(query, authContext),
    getOperationsOverview(query, authContext),
    getVendorPerformance({ ...query, page: 1, limit: 500 }, authContext),
  ]);

  return `${[
    csvRows([
      ['Finance Daily'],
      [
        'Date',
        'Channel',
        'Marketplace',
        'Currency',
        'Items',
        'Revenue (minor)',
        'Gross profit (minor)',
        'Net profit (minor)',
        'Missing cost',
      ],
      ...daily.map((row) => [
        row.date,
        row.salesChannelCode,
        row.marketplaceCode,
        row.currency,
        row.itemCount,
        row.revenueAmount,
        row.grossProfitAmount,
        row.netProfitAmount,
        row.missingCostCount,
      ]),
    ]),
    csvRows([
      ['Finance By Seller'],
      [
        'Seller code',
        'Seller name',
        'Currency',
        'Items',
        'Revenue (minor)',
        'Net profit (minor)',
        'Net margin bps',
        'Missing cost',
      ],
      ...sellers.map((row) => [
        row.sellerEmployeeCode,
        row.sellerName,
        row.currency,
        row.itemCount,
        row.revenueAmount,
        row.netProfitAmount,
        row.netMarginBps,
        row.missingCostCount,
      ]),
    ]),
    csvRows([
      ['Finance By Team'],
      [
        'Team code',
        'Team name',
        'Department',
        'Currency',
        'Sellers',
        'Items',
        'Revenue (minor)',
        'Net profit (minor)',
        'Net margin bps',
      ],
      ...teams.map((row) => [
        row.teamCode,
        row.teamName,
        row.departmentName,
        row.currency,
        row.activeSellerCount,
        row.itemCount,
        row.revenueAmount,
        row.netProfitAmount,
        row.netMarginBps,
      ]),
    ]),
    csvRows([
      ['Ads Channel Performance'],
      [
        'Channel',
        'Marketplace',
        'Currency',
        'Spend (minor)',
        'Attributed sales (minor)',
        'Orders',
        'New buyers',
        'CTR bps',
        'Conversion bps',
      ],
      ...channels.map((row) => [
        row.salesChannelCode,
        row.marketplaceCode,
        row.currency,
        row.spendAmount,
        row.attributedSalesAmount,
        row.attributedOrdersCount,
        row.newBuyerCount,
        row.ctrBps,
        row.conversionBps,
      ]),
    ]),
    csvRows(statusRows('Order Items By Status', operations.orderItemsByStatus)),
    csvRows(statusRows('Production By Status', operations.productionByStatus)),
    csvRows(statusRows('Shipments By Status', operations.shipmentsByStatus)),
    csvRows([
      ['Vendor Performance'],
      [
        'Vendor code',
        'Vendor name',
        'Ready',
        'Submitted',
        'Failed',
        'Cancelled',
        'Shipped',
        'Success rate bps',
        'Avg processing hours',
      ],
      ...(vendors.items || []).map((row) => [
        row.vendorCode,
        row.vendorName,
        row.readyCount,
        row.submittedCount,
        row.failedCount,
        row.cancelledCount,
        row.shippedCount,
        row.successRateBps,
        row.avgProcessingHours,
      ]),
    ]),
  ].join('\r\n\r\n')}\r\n`;
}

module.exports = {
  exportReportCsv,
  getAdsChannelPerformance,
  getAdsDaily,
  getAdsSellerAttribution,
  getAdsSellerDaily,
  getBuyerInsights,
  getFinanceBySeller,
  getFinanceCoverage,
  getFinanceSellerDaily,
  getFinanceByTeam,
  getFinanceDaily,
  getFinanceDailyProfit,
  getFinanceOrderProfitability,
  getFilterOptions,
  getOperationsOverview,
  getVendorPerformance,
};
