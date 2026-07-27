const fs = require('fs');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Permission = require('../../auth/models/permission.model');
const AttendanceDaily = require('../models/attendanceDaily.model');
const EmployeeProfile = require('../models/employeeProfile.model');
const SqlAttendanceSync = require('../../integration/sqlAttendance/models/sqlAttendanceSync.model');
const { hrPermissions, hrTimePermissions } = require('../constants/hr.constants');
const { assertLegacyParityCatalog } = require('./legacyParityCatalog');
const hrRouter = require('../routes');

const REQUIRED_PERMISSIONS = [...new Set([...Object.values(hrPermissions), ...Object.values(hrTimePermissions)])];

function evaluateFullHrReadiness(evidence = {}) {
  const checks = [
    ['IDENTITY_REFERENCES_MISSING', Number(evidence.identityMissingCount || 0) === 0],
    ['ATTENDANCE_RECONCILIATION_UNRESOLVED', Number(evidence.unresolvedAttendanceCount || 0) === 0],
    ['SQL_WATERMARK_LAGGING', Boolean(evidence.sqlWatermark)],
    ['PAYROLL_DIFFERENCES_PRESENT', Number.isInteger(evidence.payrollDifferenceCount) && evidence.payrollDifferenceCount === 0],
    ['MIGRATION_NOT_IDEMPOTENT', evidence.migrationIdempotent === true],
    ['HR_PERMISSIONS_MISSING', evidence.permissionsRegistered === true],
    ['HR_ROUTES_MISSING', evidence.routesRegistered === true],
    ['LEGACY_PARITY_EVIDENCE_MISSING', evidence.parityReady === true],
  ];
  const failedGateCodes = checks.filter(([, pass]) => !pass).map(([code]) => code);
  return { ready: !failedGateCodes.length, failedGateCodes };
}

function parseArgs(argv = process.argv.slice(2)) {
  const reportArg = argv.find((arg) => arg.startsWith('--payroll-diff-file='));
  return {
    payrollDiffFile: reportArg?.slice('--payroll-diff-file='.length) || null,
    migrationIdempotent: argv.includes('--migration-idempotent'),
  };
}

function readPayrollDifferenceCount(filePath) {
  if (!filePath) return null;
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(report.differences) ? report.differences.length : null;
}

async function auditFullHrReadiness({ payrollDiffFile = null, migrationIdempotent = false } = {}) {
  await connectDatabase();
  try {
    const [identityMissingCount, unresolvedAttendanceCount, sync, permissions, parity] = await Promise.all([
      EmployeeProfile.countDocuments({ accountId: null }),
      AttendanceDaily.countDocuments({ status: 'ERROR' }),
      SqlAttendanceSync.findOne({ key: 'default' }).lean(),
      Permission.find({ code: { $in: REQUIRED_PERMISSIONS } }).select('code').lean(),
      Promise.resolve(assertLegacyParityCatalog()),
    ]);
    const readiness = evaluateFullHrReadiness({
      identityMissingCount,
      unresolvedAttendanceCount,
      sqlWatermark: sync?.lastSourceTimestamp || null,
      payrollDifferenceCount: readPayrollDifferenceCount(payrollDiffFile),
      migrationIdempotent,
      permissionsRegistered: permissions.length === REQUIRED_PERMISSIONS.length,
      routesRegistered: Array.isArray(hrRouter.stack) && hrRouter.stack.length > 1,
      parityReady: parity.ready,
    });
    return readiness;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  auditFullHrReadiness(parseArgs()).then((report) => {
    logger.info('hr_full_readiness_audit_complete', report);
    if (!report.ready) process.exitCode = 1;
  }).catch((error) => {
    logger.error('hr_full_readiness_audit_failed', { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = { auditFullHrReadiness, evaluateFullHrReadiness, parseArgs, readPayrollDifferenceCount };
