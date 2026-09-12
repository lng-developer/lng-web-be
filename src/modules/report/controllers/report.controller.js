const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/report.service');
const {
  baseReportQuerySchema,
  financeOrderProfitabilityQuerySchema,
  financeReportQuerySchema,
  vendorPerformanceQuerySchema,
} = require('../validators/report.validator');
const { assertValid } = require('./requestValidation');

function boundedAuditText(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function auditAuth(req) {
  return {
    ...req.auth,
    auditContext: {
      requestId: boundedAuditText(req.id, 200),
      ipAddress: boundedAuditText(req.ip, 100),
      userAgent: boundedAuditText(req.get('user-agent'), 500),
    },
  };
}

async function getFinanceDaily(req, res) {
  const query = assertValid(financeReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getFinanceDaily(query, auditAuth(req)) });
}

async function getFinanceCoverage(req, res) {
  const query = assertValid(financeReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getFinanceCoverage(query, auditAuth(req)) });
}

async function getFilterOptions(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await service.getFilterOptions(req.auth) });
}

async function getBuyerInsights(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getBuyerInsights(query, req.auth) });
}

async function getAdsChannelPerformance(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res
    .status(httpStatus.OK)
    .json({ success: true, data: await service.getAdsChannelPerformance(query, auditAuth(req)) });
}

async function getAdsSellerAttribution(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getAdsSellerAttribution(query, auditAuth(req)) });
}

async function getAdsDaily(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getAdsDaily(query, auditAuth(req)) });
}

async function getAdsSellerDaily(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getAdsSellerDaily(query, auditAuth(req)) });
}

async function getFinanceDailyProfit(req, res) {
  const query = assertValid(financeReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getFinanceDailyProfit(query, auditAuth(req)) });
}

async function getFinanceOrderProfitability(req, res) {
  const query = assertValid(financeOrderProfitabilityQuerySchema, req.query);
  res
    .status(httpStatus.OK)
    .json({ success: true, data: await service.getFinanceOrderProfitability(query, auditAuth(req)) });
}

async function getFinanceBySeller(req, res) {
  const query = assertValid(financeReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getFinanceBySeller(query, auditAuth(req)) });
}

async function getFinanceSellerDaily(req, res) {
  const query = assertValid(financeReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getFinanceSellerDaily(query, auditAuth(req)) });
}

async function getFinanceByTeam(req, res) {
  const query = assertValid(financeReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getFinanceByTeam(query, auditAuth(req)) });
}

async function getVendorPerformance(req, res) {
  const query = assertValid(vendorPerformanceQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getVendorPerformance(query, req.auth) });
}

async function getOperationsOverview(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getOperationsOverview(query, req.auth) });
}

async function exportReportCsv(req, res) {
  const query = assertValid(financeReportQuerySchema, req.query);
  const csv = await service.exportReportCsv(query, auditAuth(req));
  res
    .status(httpStatus.OK)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="reports.csv"')
    .send(csv);
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
