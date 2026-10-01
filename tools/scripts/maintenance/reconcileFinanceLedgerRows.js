function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function vietnamDate(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error('Dates must use YYYY-MM-DD');
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+07:00`);
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  const dateFromValue = argument('--date-from', dryRun ? '2026-08-15' : undefined);
  const dateToValue = argument('--date-to', dryRun ? '2026-09-17' : undefined);
  if (!dateFromValue || !dateToValue) throw new Error('--apply requires --date-from and --date-to');
  const dateFrom = vietnamDate(dateFromValue);
  const dateTo = vietnamDate(dateToValue, true);
  if (dateFrom > dateTo) throw new Error('--date-from must not be after --date-to');
  const ledgerCategory = argument('--ledger-category', undefined);
  const limit = Number(argument('--limit', '100'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('--limit must be an integer from 1 to 10000');
  const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
  const { reconcileUnlinkedLedgerRows } = require('../../../src/modules/finance/services/financeImport.service');
  await connectDatabase();
  try {
    const result = await reconcileUnlinkedLedgerRows({ dateFrom, dateTo, ledgerCategory, limit, dryRun });
    process.stdout.write(`${JSON.stringify({ dateFrom, dateTo, ...result })}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
