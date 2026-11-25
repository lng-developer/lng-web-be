'use strict';

// November 2026, Asia/Ho_Chi_Minh. This repair changes no order or vendor data.
const scope = {
  orderedAt: { $gte: new Date('2026-10-31T17:00:00Z'), $lt: new Date('2026-11-30T17:00:00Z') },
  financialStatus: 'CANCELLED',
  feeSource: 'ESTIMATED_15_PERCENT',
  feeAmount: { $gt: 0 },
};

function correction(snapshot, calculateMargin) {
  if (snapshot.financialStatus !== 'CANCELLED' || snapshot.feeSource !== 'ESTIMATED_15_PERCENT'
    || !Number.isInteger(snapshot.feeAmount) || snapshot.feeAmount <= 0 || snapshot.netRevenueAmount !== 0) {
    throw new Error('Snapshot is not eligible');
  }
  return {
    feeAmount: 0,
    ...calculateMargin({ ...snapshot, feeAmount: 0 }, snapshot.actualVendorTotalAmount ?? snapshot.totalCostAmount, snapshot.costStatus),
  };
}

async function run() {
  const fs = require('fs');
  const path = require('path');
  const { createRequire } = require('module');
  const appRequire = createRequire(path.join(process.cwd(), 'package.json'));
  appRequire('dotenv').config({ quiet: true });
  const mongoose = appRequire('mongoose');
  const config = appRequire('./src/config');
  const { calculateMargin } = appRequire('./src/modules/finance/services/financeSnapshot.service');
  const args = process.argv.slice(2);
  const database = args.find(arg => arg.startsWith('--database='))?.slice(11);
  const backup = args.find(arg => arg.startsWith('--backup='))?.slice(9);
  const apply = args.includes('--apply');
  if (!database || (apply && !backup)) throw new Error('Require --database and, for --apply, --backup');
  await mongoose.connect(config.database.uri, { autoIndex: false, autoCreate: false, maxPoolSize: 2 });
  try {
    const db = mongoose.connection.db;
    if (db.databaseName !== database) throw new Error('Database mismatch');
    const snapshots = db.collection('financesnapshots');
    const candidates = await snapshots.find(scope).toArray();
    const preview = candidates.map(row => ({ id: String(row._id), orderItemId: String(row.orderItemId), beforeFee: row.feeAmount, beforeProfit: row.grossProfitAmount, after: correction(row, calculateMargin) }));
    console.log(JSON.stringify({ database, apply, preview }));
    if (!apply) return;
    fs.writeFileSync(backup, JSON.stringify(candidates), { flag: 'wx', mode: 0o600 });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const before of candidates) {
          const current = await snapshots.findOne({ ...scope, _id: before._id, updatedAt: before.updatedAt }, { session });
          if (!current) throw new Error('Snapshot changed; rerun dry-run');
          const item = await db.collection('orderitems').findOne({ _id: current.orderItemId }, { session });
          if (!item || ![item.status, item.externalStatus].some(status => ['CANCELLED', 'CANCELED', 'PARTIALLY_CANCELLED'].includes(String(status).toUpperCase()))) {
            throw new Error('Source item is not cancelled');
          }
          const importedFee = item.finance?.feeAmount ?? item.externalData?.finance?.feeAmount;
          const actualFee = await db.collection('marketplacefeelines').findOne({
            $or: [{ orderItemId: item._id }, { shopId: item.shopId, externalOrderId: item.externalOrderId }],
          }, { session, projection: { _id: 1 } });
          if (importedFee != null || actualFee) throw new Error('Actual fee exists; use normal reconciliation');
          const update = await snapshots.updateOne({ _id: current._id, updatedAt: current.updatedAt }, {
            $set: { ...correction(current, calculateMargin), updatedAt: new Date(), calculatedAt: new Date() },
          }, { session });
          if (update.modifiedCount !== 1) throw new Error('Concurrent snapshot change');
        }
      });
    } finally { await session.endSession(); }
    console.log(JSON.stringify({ modified: candidates.length, remaining: await snapshots.countDocuments(scope), backup }));
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { correction, scope };
