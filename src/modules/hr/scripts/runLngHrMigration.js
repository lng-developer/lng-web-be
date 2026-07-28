const fs = require('fs');
const logger = require('../../../shared/utils/logger');
const { migrateLngHrData, parseArgs } = require('./migrateLngHrData');

const COUNT_FIELDS = ['read', 'mapped', 'inserted', 'updated', 'unchanged', 'skipped', 'failed'];

function parseReportArgs(argv = process.argv.slice(2)) {
  const reportFile = argv.find((arg) => arg.startsWith('--report-file='))?.slice('--report-file='.length);
  if (!reportFile) throw new Error('--report-file is required');
  return { ...parseArgs(argv), reportFile };
}

function toCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function toSafeMigrationReport(report = {}) {
  const results = Object.fromEntries(Object.entries(report.results || {}).map(([name, result]) => [
    name,
    Object.fromEntries(COUNT_FIELDS.map((field) => [field, toCount(result?.[field])])),
  ]));
  const values = Object.values(results);
  return {
    mode: report.mode,
    sourceDb: report.sourceDb,
    targetDb: report.targetDb,
    unresolvedCount: values.reduce((sum, result) => sum + result.skipped + result.failed, 0),
    writeCount: values.reduce((sum, result) => sum + result.inserted + result.updated, 0),
    results,
  };
}

function writeSafeMigrationReport(report, reportFile) {
  fs.writeFileSync(reportFile, `${JSON.stringify(toSafeMigrationReport(report))}\n`, { encoding: 'utf8', flag: 'w' });
}

async function main(argv = process.argv.slice(2)) {
  const { reportFile, ...options } = parseReportArgs(argv);
  const report = await migrateLngHrData(options);
  const safeReport = toSafeMigrationReport(report);
  writeSafeMigrationReport(report, reportFile);
  logger.info('lng_hr_safe_migration_report_complete', safeReport);
  if (safeReport.unresolvedCount) process.exitCode = 2;
  return safeReport;
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('lng_hr_safe_migration_report_failed', { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = { main, parseReportArgs, toSafeMigrationReport, writeSafeMigrationReport };
