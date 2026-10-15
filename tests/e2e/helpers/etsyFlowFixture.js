const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const databaseName = `etsy_flow_test_${process.pid}`;
let replica;

async function startDatabase() {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri(), { dbName: databaseName });
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

async function stopDatabase() {
  await mongoose.disconnect();
  if (replica) await replica.stop();
}

async function clearDatabase() {
  if (!replica || mongoose.connection.name !== databaseName || !databaseName.startsWith('etsy_flow_test_')) {
    throw new Error('Refusing cleanup outside ephemeral Etsy test database');
  }
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
}

function etsyRow(patch = {}) {
  return {
    'Sale Date': '10/01/2026', 'Order ID': '9000000001', 'Transaction ID': '9000000002',
    'Listing ID': '9000000003', 'Item Name': 'Synthetic personalized ornament',
    SKU: 'TEST-ORNAMENT', Quantity: '1', Price: '20', Currency: 'USD',
    'Ship Name': 'Test Buyer', 'Ship Address1': '1 Test Street', 'Ship City': 'Test City',
    'Ship State': 'NY', 'Ship Zipcode': '10001', 'Ship Country': 'United States',
    Variations: 'Size:8in,Personalization:Alex/Test',
    'LNG Etsy Status': 'New', 'LNG Payment Status': 'PAID',
    ...patch,
  };
}

function csvBuffer(rows) {
  const headers = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return Buffer.from([headers.map(cell).join(','), ...rows.map((row) => headers.map((key) => cell(row[key])).join(','))].join('\n'));
}

module.exports = { startDatabase, stopDatabase, clearDatabase, etsyRow, csvBuffer };
