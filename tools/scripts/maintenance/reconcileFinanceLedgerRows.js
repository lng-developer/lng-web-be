const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const { reconcileUnlinkedLedgerRows } = require('../../../src/modules/finance/services/financeImport.service');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function vietnamDate(value, endOfDay = false) {
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+07:00`);
}

async function main() {
  const dateFrom = vietnamDate(argument('--date-from', '2026-08-15'));
  const dateTo = vietnamDate(argument('--date-to', '2026-09-17'), true);
  const ledgerCategory = argument('--ledger-category', undefined);
  const limit = Number(argument('--limit', '100'));
  const dryRun = !process.argv.includes('--apply');
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
