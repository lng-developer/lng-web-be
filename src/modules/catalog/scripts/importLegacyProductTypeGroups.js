const fs = require('fs');
const path = require('path');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const ProductTypeGroup = require('../models/productTypeGroup.model');
const { recordStatuses } = require('../constants/catalog.constants');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce(
    (args, arg) => {
      const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
      if (!key) return args;
      args[key] = valueParts.length > 0 ? valueParts.join('=') : true;
      return args;
    },
    {
      dryRun: 'true',
      file: path.resolve('C:/data backup portal/lng_db.producttypegroups.json'),
    },
  );
}

function unwrapExtendedJson(value) {
  if (value && typeof value === 'object') {
    if (value.$oid) return value.$oid;
    if (value.$date) return new Date(value.$date);
  }
  return value;
}

function toCode(name) {
  return String(name || '')
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function mapLegacyGroup(rawGroup) {
  const name = String(rawGroup.name || '').trim();
  const code = toCode(name);

  return {
    legacyId: unwrapExtendedJson(rawGroup._id),
    payload: {
      code,
      name,
      sortOrder: toInteger(rawGroup.order, 0),
      status: recordStatuses.ACTIVE,
    },
    skippedVendorItems: Array.isArray(rawGroup.items) ? rawGroup.items.length : 0,
  };
}

function readJsonArray(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error('Legacy product type group export must be a JSON array');
  }
  return parsed;
}

async function importLegacyProductTypeGroups({ file, dryRun = true } = {}) {
  const groups = readJsonArray(file);
  const summary = {
    file,
    dryRun,
    scanned: groups.length,
    create: 0,
    update: 0,
    skip: 0,
    errors: [],
    skippedVendorItems: 0,
  };
  const seenCodes = new Set();

  for (const rawGroup of groups) {
    const mapped = mapLegacyGroup(rawGroup);
    summary.skippedVendorItems += mapped.skippedVendorItems;

    if (!mapped.payload.code || !mapped.payload.name) {
      summary.skip += 1;
      summary.errors.push({
        legacyId: mapped.legacyId,
        reason: 'Missing name/code',
      });
      continue;
    }

    if (seenCodes.has(mapped.payload.code)) {
      summary.skip += 1;
      summary.errors.push({
        legacyId: mapped.legacyId,
        code: mapped.payload.code,
        reason: 'Duplicate code in legacy export',
      });
      continue;
    }
    seenCodes.add(mapped.payload.code);

    const existing = await ProductTypeGroup.findOne({ code: mapped.payload.code }).lean();
    if (existing) summary.update += 1;
    else summary.create += 1;

    if (dryRun) continue;

    await ProductTypeGroup.findOneAndUpdate(
      { code: mapped.payload.code },
      {
        $set: {
          name: mapped.payload.name,
          sortOrder: mapped.payload.sortOrder,
          status: mapped.payload.status,
        },
        $setOnInsert: {
          code: mapped.payload.code,
        },
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();
  }

  return summary;
}

async function main() {
  const args = parseArgs();
  const dryRun = String(args.dryRun).toLowerCase() !== 'false';
  const file = path.resolve(args.file);

  await connectDatabase();

  try {
    const summary = await importLegacyProductTypeGroups({ file, dryRun });
    logger.info('legacy_product_type_group_import_complete', summary);
    // Keep a plain JSON line for copy/paste audit and CI logs.
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('legacy_product_type_group_import_failed', error);
    process.exitCode = 1;
  });
}

module.exports = {
  importLegacyProductTypeGroups,
  mapLegacyGroup,
  parseArgs,
  toCode,
};
