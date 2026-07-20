const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/report.service');
const {
  baseReportQuerySchema,
  vendorPerformanceQuerySchema,
} = require('../validators/report.validator');
const { assertValid } = require('./requestValidation');

async function getFinanceDaily(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getFinanceDaily(query, req.auth),
  });
}

async function getBuyerInsights(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getBuyerInsights(query, req.auth),
  });
}

async function getAdsChannelPerformance(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getAdsChannelPerformance(query, req.auth),
  });
}

async function getFinanceDailyProfit(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getFinanceDailyProfit(query, req.auth),
  });
}

async function getFinanceBySeller(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getFinanceBySeller(query, req.auth),
  });
}

async function getFinanceByTeam(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getFinanceByTeam(query, req.auth),
  });
}

async function getVendorPerformance(req, res) {
  const query = assertValid(vendorPerformanceQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getVendorPerformance(query, req.auth),
  });
}

async function getOperationsOverview(req, res) {
  const query = assertValid(baseReportQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getOperationsOverview(query, req.auth),
  });
}

module.exports = {
  getAdsChannelPerformance,
  getBuyerInsights,
  getFinanceBySeller,
  getFinanceByTeam,
  getFinanceDaily,
  getFinanceDailyProfit,
  getOperationsOverview,
  getVendorPerformance,
};
