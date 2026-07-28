const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/payroll.service');
const payrollEmailService = require('../services/payrollEmail.service');
const {
  emailPayrollSchema,
  exportPayrollResultsSchema,
  finalizePayrollSchema,
  listMyPayrollSchema,
  listPayrollResultsSchema,
  listPayrollSchema,
  markPaidSchema,
  payrollRunParamsSchema,
  payrollResultParamsSchema,
  runPayrollSchema,
  validate,
} = require('../validators/payroll.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  return value;
}

async function runPayroll(req, res) {
  const payload = assertValid(runPayrollSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.calculatePayroll(payload, req.auth) });
}

async function listPayrolls(req, res) {
  const query = assertValid(listPayrollSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listPayrollRuns(query, req.auth) });
}

async function listPayrollResults(req, res) {
  const query = assertValid(listPayrollResultsSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listPayrollResults(query, req.auth) });
}

async function exportPayrollResults(req, res) {
  const query = assertValid(exportPayrollResultsSchema, req.query);
  const exported = await service.exportPayrollResults(query, req.auth);
  res
    .status(httpStatus.OK)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${exported.filename}"`)
    .send(exported.csv);
}

async function getPayrollResult(req, res) {
  const { resultId } = assertValid(payrollResultParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.getPayrollResult(resultId, req.auth) });
}

async function getPayroll(req, res) {
  const { id } = assertValid(payrollRunParamsSchema, req.params);
  res.status(httpStatus.OK).json({ success: true, data: await service.getPayrollRun(id, req.auth) });
}

async function listMyPayrolls(req, res) {
  const query = assertValid(listMyPayrollSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listMyPayrollResults(query, req.auth) });
}

async function finalizePayroll(req, res) {
  const { id } = assertValid(payrollRunParamsSchema, req.params);
  const payload = assertValid(finalizePayrollSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.finalizePayroll({ payrollRunId: id, ...payload }, req.auth),
  });
}

async function markPayrollPaid(req, res) {
  const { id } = assertValid(payrollRunParamsSchema, req.params);
  const payload = assertValid(markPaidSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markPayrollPaid({ payrollRunId: id, ...payload }, req.auth),
  });
}

async function emailPayroll(req, res) {
  const { id } = assertValid(payrollRunParamsSchema, req.params);
  assertValid(emailPayrollSchema, req.body || {});
  res.status(httpStatus.ACCEPTED).json({
    success: true,
    data: await payrollEmailService.queuePayrollEmails(id, req.auth),
  });
}

module.exports = { emailPayroll, exportPayrollResults, finalizePayroll, getPayroll, getPayrollResult, listMyPayrolls, listPayrollResults, listPayrolls, markPayrollPaid, runPayroll };
