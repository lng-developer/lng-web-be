const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const config = require('../../../config');
const logger = require('../../../shared/utils/logger');
const AuditEvent = require('../models/auditEvent.model');
const { safeDatabaseTarget } = require('./ensureAuditIndexes');

const FILTER = Object.freeze({ action: { $regex: /_READ$/ } });
const FILTER_DESCRIPTION = 'action ends with _READ';

function restoreUri(database) {
  const [base, query] = config.database.uri.split('?');
  const separator = base.lastIndexOf('/');
  if (separator < base.indexOf('//') + 2) throw new Error('MongoDB URI has no database name');
  return `${base.slice(0, separator + 1)}${database}${query ? `?${query}` : ''}`;
}

function backupFile() {
  return path.resolve(process.cwd(), 'storage', 'backups', `audit-read-events-${Date.now()}.json`);
}

async function writeAndVerifyBackup(events, target) {
  const file = backupFile();
  const payload = {
    filter: FILTER_DESCRIPTION,
    target,
    count: events.length,
    eventIds: events.map((event) => String(event._id)),
    events,
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, EJSON.stringify(payload, null, 2), 'utf8');
  const restored = EJSON.parse(await fs.readFile(file, 'utf8'));
  if (restored.filter !== FILTER_DESCRIPTION || restored.count !== events.length
    || restored.events.length !== events.length
    || restored.eventIds.join(',') !== payload.eventIds.join(',')) {
    throw new Error('Audit backup verification failed');
  }
  return { file, payload: restored };
}

async function verifyRestore(payload) {
  if (!payload.count) return null;
  const database = `audit_restore_${crypto.randomUUID().slice(0, 8)}`;
  const connection = await mongoose.createConnection(restoreUri(database)).asPromise();
  try {
    const collection = connection.collection(AuditEvent.collection.name);
    await collection.insertMany(payload.events);
    const restoredIds = (await collection.find({}, { projection: { _id: 1 } }).toArray())
      .map((event) => String(event._id)).sort();
    const expectedIds = [...payload.eventIds].sort();
    if (restoredIds.length !== expectedIds.length || restoredIds.join(',') !== expectedIds.join(',')) {
      throw new Error('Audit restore verification failed');
    }
    return { database, count: restoredIds.length };
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
}

async function removeReadAuditEvents({ apply = process.argv.includes('--apply') } = {}) {
  const connection = await connectDatabase();
  try {
    const target = safeDatabaseTarget(connection);
    const events = await AuditEvent.collection.find(FILTER).toArray();
    const backup = await writeAndVerifyBackup(events, target);
    const restoreCheck = await verifyRestore(backup.payload);
    const proof = { target, filter: FILTER_DESCRIPTION, count: events.length, backupFile: backup.file, restoreCheck, deletedCount: 0 };
    if (!apply || !events.length) return proof;

    const result = await AuditEvent.collection.deleteMany(FILTER);
    if (result.deletedCount !== events.length) throw new Error('Audit deletion count does not match backup count');
    if (await AuditEvent.collection.countDocuments(FILTER)) throw new Error('Audit deletion verification failed');
    return { ...proof, deletedCount: result.deletedCount };
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  removeReadAuditEvents().then((proof) => {
    logger.info('Audit read-event cleanup proof', proof);
  }).catch((error) => {
    logger.error('Audit read-event cleanup failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { FILTER, removeReadAuditEvents };
