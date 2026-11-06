const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const VendorCostCenter = require('../models/vendorCostCenter.model');

const VENDOR_PRODUCT_ID = new mongoose.Types.ObjectId('6aac937332a0dd30e554abfe');

function optionsFromCode(code) {
  const match = String(code || '').match(/^PRODUCT_CMS_LNGCMS(8|10|12|14|18|24|30|36)(?:_2SIDES)?$/);
  if (!match) return null;
  return {
    vendorSize: match[1],
    standardSize: match[1],
    printMethod: String(code).includes('_2SIDES') ? 'TWO_SIDED' : 'ONE_SIDED',
  };
}

async function backfill({ apply = false } = {}) {
  const rows = await VendorCostCenter.find({ vendorProductId: VENDOR_PRODUCT_ID }).lean();
  const changes = rows.map((row) => {
    const patch = optionsFromCode(row.code);
    if (!patch) return null;
    const changed = Object.keys(patch).some((key) => row[key] !== patch[key]);
    return changed ? { id: row._id, code: row.code, patch } : null;
  }).filter(Boolean);

  if (apply) {
    for (const change of changes) {
      await VendorCostCenter.updateOne({ _id: change.id }, { $set: change.patch });
    }
  }
  return { matched: rows.length, changed: changes.length, applied: apply, changes };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  connectDatabase()
    .then(() => backfill({ apply }))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => disconnectDatabase());
}

module.exports = { optionsFromCode, backfill };
