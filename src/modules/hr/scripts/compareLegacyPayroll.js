const mongoose = require('mongoose');
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
  const key = aliases[field].find((candidate) => row[candidate] !== undefined);
  return key ? Number(row[key]) : undefined;
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
      if (legacyValue === undefined && podValue === undefined) continue;
      if (legacyValue !== podValue) differences.push({
        employeeCode: code, field, legacy: legacyValue, pod: podValue, delta: podValue - legacyValue,
      });
    }
  }
  return differences;
}

function parseArgs(argv = process.argv.slice(2)) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { month: Number(value('month')), year: Number(value('year')) };
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
  compareLegacyPayroll(parseArgs()).then((report) => {
    logger.info('hr_payroll_comparison_complete', {
      month: report.month, year: report.year, legacyCount: report.legacyCount, podCount: report.podCount,
      differenceCount: report.differences.length,
    });
    if (report.differences.length) process.exitCode = 1;
  }).catch((error) => {
    logger.error('hr_payroll_comparison_failed', { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = { compareLegacyPayroll, comparePayrollRows, parseArgs };
