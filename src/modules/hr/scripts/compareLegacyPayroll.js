const mongoose = require('mongoose');
const fs = require('fs');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const PayrollResult = require('../models/payrollResult.model');

const COMPARED_FIELDS = ['net', 'gross', 'salaryFromWork', 'overtimePay', 'totalDeductions'];

function employeeCode(row = {}) {
  return row.employeeCode || row.employeeCodeSnapshot || row.employeeSnapshot?.employeeCode || null;
}

function fieldValue(row, field) {
  const aliases = {
    net: ['net', 'netIncome'],
    gross: ['gross', 'grossIncome'],
    salaryFromWork: ['salaryFromWork'],
    overtimePay: ['overtimePay', 'otPay'],
    totalDeductions: ['totalDeductions', 'totalDeduction'],
  };
  const key = aliases[field].find((candidate) => Object.hasOwn(row, candidate));
  if (!key) return 'MISSING';
  if (row[key] === null) return null;
  const value = Number(row[key]);
  return Number.isFinite(value) ? Math.round(value) : 'INVALID';
}

function comparePayrollRows(legacyRows = [], podRows = []) {
  const legacyByEmployee = new Map(legacyRows.map((row) => [employeeCode(row), row]).filter(([code]) => code));
  const podByEmployee = new Map(podRows.map((row) => [employeeCode(row), row]).filter(([code]) => code));
  const differences = [];
  for (const code of [...new Set([...legacyByEmployee.keys(), ...podByEmployee.keys()])].sort()) {
    const legacy = legacyByEmployee.get(code);
    const pod = podByEmployee.get(code);
    if (!legacy || !pod) {
      differences.push({ employeeCode: code, field: 'record', legacy: Boolean(legacy), pod: Boolean(pod), delta: null });
      continue;
    }
    for (const field of COMPARED_FIELDS) {
      const legacyValue = fieldValue(legacy, field);
      const podValue = fieldValue(pod, field);
      if (legacyValue === 'MISSING' && podValue === 'MISSING') continue;
      if (legacyValue !== podValue) differences.push({
        employeeCode: code,
        field,
        legacy: legacyValue,
        pod: podValue,
        delta: Number.isInteger(legacyValue) && Number.isInteger(podValue) ? podValue - legacyValue : null,
      });
    }
  }
  return differences;
}

function parseArgs(argv = process.argv.slice(2)) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    month: Number(value('month')),
    year: Number(value('year')),
    reportFile: value('report-file') || null,
  };
}

function toSafeComparisonReport(report) {
  const differenceCount = report.differences.length;
  return {
    month: report.month,
    year: report.year,
    legacyCount: report.legacyCount,
    podCount: report.podCount,
    differenceCount,
    gateCodes: differenceCount ? ['PAYROLL_DIFFERENCES_PRESENT'] : [],
  };
}

function writeSafeComparisonReport(report, filePath) {
  fs.writeFileSync(filePath, `${JSON.stringify(toSafeComparisonReport(report))}\n`, { encoding: 'utf8', flag: 'w' });
}

async function compareLegacyPayroll({ month, year, sourceUri = process.env.SOURCE_MONGODB_URI } = {}) {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) throw new Error('month and year are required');
  if (!sourceUri) throw new Error('SOURCE_MONGODB_URI is required');
  const source = await mongoose.createConnection(sourceUri, { serverSelectionTimeoutMS: 15000 }).asPromise();
  await connectDatabase();
  try {
    const [legacyRows, podRows] = await Promise.all([
      source.db.collection('payrolls').find({ month, year }).toArray(),
      PayrollResult.aggregate([
        { $lookup: { from: 'hrpayrollruns', localField: 'payrollRunId', foreignField: '_id', as: 'run' } },
        { $unwind: '$run' },
        { $match: { 'run.month': month, 'run.year': year } },
      ]),
    ]);
    const differences = comparePayrollRows(legacyRows, podRows);
    return { month, year, legacyCount: legacyRows.length, podCount: podRows.length, differences };
  } finally {
    await source.close();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  const args = parseArgs();
  compareLegacyPayroll(args).then((report) => {
    const safeReport = toSafeComparisonReport(report);
    writeSafeComparisonReport(report, args.reportFile || `hr-payroll-compare-${report.year}-${report.month}.json`);
    logger.info('hr_payroll_comparison_complete', safeReport);
    if (report.differences.length) process.exitCode = 1;
  }).catch((error) => {
    logger.error('hr_payroll_comparison_failed', { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = { compareLegacyPayroll, comparePayrollRows, parseArgs, toSafeComparisonReport, writeSafeComparisonReport };
