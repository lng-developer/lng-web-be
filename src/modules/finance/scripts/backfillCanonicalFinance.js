const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');

async function main() {
  const { values } = parseArgs({ options: {
    seller: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
    'expect-database': { type: 'string' }, output: { type: 'string' },
    apply: { type: 'boolean', default: false }, resume: { type: 'string' }, rollback: { type: 'boolean', default: false },
  } });
  if (!values.output || !values['expect-database']) throw new Error('--output and --expect-database required');
  if ((values.apply || values.rollback) && !values.resume) throw new Error('Apply/rollback requires a reviewed --resume manifest');
  if (values.apply && values.rollback) throw new Error('Choose apply or rollback');
  const output = path.resolve(values.output);
  const resume = values.resume ? JSON.parse(await fs.readFile(path.resolve(values.resume), 'utf8')) : null;
  if (!resume) await fs.writeFile(output, '{}\n', { flag: 'wx', mode: 0o600 });
  mongoose.set('autoCreate', false);
  mongoose.set('autoIndex', false);
  const config = require('../../../config');
  const { runBackfill, rollbackBackfill } = require('../services/financeCanonicalBackfill.service');
  await mongoose.connect(config.database.uri, { autoCreate: false, autoIndex: false });
  try {
    const options = { database: mongoose.connection.name, expectDatabase: values['expect-database'],
      seller: values.seller, from: values.from, to: values.to, apply: values.apply, resume };
    process.stdout.write(`Database: ${options.database}; mode: ${values.rollback ? 'rollback' : values.apply ? 'apply' : 'dry-run'}\n`);
    const save = async manifest => {
      await fs.writeFile(`${output}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(`${output}.tmp`, output);
    };
    const result = await (values.rollback ? rollbackBackfill : runBackfill)(options, { save });
    const counts = result.entries.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
    process.stdout.write(`${JSON.stringify({ output, counts })}\n`);
    if (result.entries.some(row => /FAILED|CONFLICT|APPLYING/.test(row.status))) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main };
