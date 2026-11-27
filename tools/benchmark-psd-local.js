// Local synthetic benchmark; never reads .env or connects to a remote database.
const http = require('http');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const mongoose = require('mongoose');
const assert = require('assert/strict');
const dbName = `psd_benchmark_${process.pid}_${Date.now()}`;
process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${dbName}`;
process.env.REDIS_ENABLED = 'false';
process.env.NODE_ENV = 'test';
const root = path.resolve(__dirname, '..');
const servicePath = 'src/modules/design/services/designTask.service.js';
const current = require(path.join(root, servicePath));
const baseline = new Module(path.join(root, servicePath), module);
baseline.filename = path.join(root, servicePath);
baseline.paths = module.paths;
baseline._compile(execFileSync('git', ['show', `5990e459:${servicePath}`], { cwd: root, encoding: 'utf8' }), baseline.filename);
const DesignTask = require('../src/modules/design/models/designTask.model');
const OrderItem = require('../src/modules/order/models/orderItem.model');
const ProductionTask = require('../src/modules/production/models/productionTask.model');
const Listing = require('../src/modules/catalog/models/listing.model');
const Shop = require('../src/modules/shop/models/shop.model');
const repo = require('../src/modules/design/repositories/designTask.repository');
let stages = {};
for (const method of ['list', 'listAsinGroups']) {
  const original = repo[method];
  repo[method] = async (...args) => {
    const start = performance.now();
    try { return await original(...args); } finally { stages[method] = performance.now() - start; }
  };
}
const production = require('../src/modules/production/public');
const summarize = production.summarizeScaleFilesByListings;
production.summarizeScaleFilesByListings = async (...args) => {
  const start = performance.now();
  try { return await summarize(...args); } finally { stages.scaleFiles = performance.now() - start; }
};
const query = { page: 1, limit: 50, sortBy: 'urgency', taskType: 'PSD_TEMPLATE', salesChannelCode: 'AMAZON' };
const auth = { permissions: ['DESIGN:READ'], scopes: [] };
let commands = 0;
const server = http.createServer(async (req, res) => {
  try {
    stages = {}; commands = 0;
    const start = performance.now();
    const result = await (req.url === '/before' ? baseline.exports : current).listTasks(
      req.url === '/before' ? query : { ...query, view: 'table' }, auth,
    );
    const body = JSON.stringify(result);
    res.setHeader('Server-Timing', `app;dur=${performance.now() - start}`);
    res.setHeader('X-DB-Reads', commands);
    res.setHeader('X-Stages', JSON.stringify(stages));
    res.end(body);
  } catch (error) { res.statusCode = 500; res.end(error.stack); }
});
async function main() {
  console.log(JSON.stringify({ database: dbName, fixture: '500 tasks, 500 listings, 5 submissions/task; local Mongo; no auth middleware' }));
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, monitorCommands: true });
  mongoose.connection.getClient().on('commandStarted', ({ commandName }) => {
    if (['find', 'aggregate', 'count', 'distinct', 'getMore'].includes(commandName)) commands++;
  });
  const tasks = [], items = [], productions = [], listings = [];
  const shopId = new mongoose.Types.ObjectId();
  await Shop.collection.insertOne({ _id: shopId, name: 'Synthetic shop', code: 'BENCH' });
  for (let i = 0; i < 500; i++) {
    const listingId = new mongoose.Types.ObjectId(), itemId = new mongoose.Types.ObjectId();
    const snapshot = { id: String(listingId), asin: `B${String(i).padStart(9, '0')}`, salesChannelCode: 'AMAZON', title: 'Synthetic PSD task' };
    listings.push({ _id: listingId, shopId, ...snapshot });
    tasks.push({ _id: new mongoose.Types.ObjectId(), shopId, listingId, targetListingId: listingId,
      taskType: 'PSD_TEMPLATE', status: 'REQUESTED', priority: 'NORMAL', listingSnapshot: snapshot,
      createdAt: new Date(1700000000000 + i * 1000), submissions: Array.from({ length: 5 }, (_, n) => ({ version: n + 1, status: 'REJECTED', assetIds: [], submittedAt: new Date(), rejectedAt: new Date(), note: 'Synthetic revision' })) });
    items.push({ _id: itemId, listingId });
    productions.push({ _id: new mongoose.Types.ObjectId(), shopId, orderItemId: itemId, blockers: ['PSD_MISSING'], listingSnapshot: snapshot,
      orderItemSnapshot: { externalOrderId: `ORDER-${i}` }, fileChecks: [{ sourceType: 'CUSTOMER_IMAGE', required: true, inputAssetId: new mongoose.Types.ObjectId(), blockers: [] }] });
  }
  await Promise.all([DesignTask.collection.insertMany(tasks), OrderItem.collection.insertMany(items),
    ProductionTask.collection.insertMany(productions), Listing.collection.insertMany(listings)]);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (let round = 0; round < 6; round++) {
    let expected;
    for (const mode of ['before', 'after']) {
      const start = performance.now();
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${mode}`);
      const ttfb = performance.now() - start;
      const body = await response.text();
      if (!response.ok) throw new Error(body);
      const data = JSON.parse(body);
      if (data.items.length !== 50 || data.items.some(row => row.scaleFileSummary?.totalFileCount !== 1)) {
        throw new Error('Benchmark fixture must exercise file totals for all 50 rows');
      }
      for (const row of data.items) delete row.history;
      if (mode === 'before') expected = data;
      else assert.deepEqual(data, expected, 'Table fields, order and pagination must remain identical');
      console.log(JSON.stringify({ mode, warmup: round === 0, ttfbMs: +ttfb.toFixed(2), downloadMs: +(performance.now() - start - ttfb).toFixed(2),
        bytes: Buffer.byteLength(body), dbReads: Number(response.headers.get('x-db-reads')), server: response.headers.get('server-timing'), stages: JSON.parse(response.headers.get('x-stages')) }));
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  server.close();
  // Only this process's freshly created, fixed-prefix scratch database is removed.
  if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
