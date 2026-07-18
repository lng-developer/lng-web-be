const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const { hrRequestStatuses } = require('../constants/hr.constants');
const LeaveRequest = require('../models/leaveRequest.model');
const OvertimeRequest = require('../models/overtimeRequest.model');

async function findActiveDuplicates(Model, conflictField) {
  return Model.aggregate([
    { $match: { status: { $in: [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED] } } },
    { $unwind: `$${conflictField}` },
    {
      $group: {
        _id: { profileId: '$profileId', conflictKey: `$${conflictField}` },
        count: { $sum: 1 },
        requestIds: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { '_id.profileId': 1, '_id.conflictKey': 1 } },
  ]);
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function arraysEqual(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function validLeaveCanonicalValues(record, conflictField) {
  const values = record[conflictField];
  const snapshots = record.workingDateSnapshots;
  const portions = record.portion === 'FULL_DAY'
    ? ['MORNING', 'AFTERNOON']
    : [record.portion];
  if (!Array.isArray(values) || values.length === 0) return false;
  if (!Array.isArray(snapshots) || snapshots.length === 0) return false;
  if (!portions.every((portion) => ['MORNING', 'AFTERNOON'].includes(portion))) return false;

  const expectedUnits = record.portion === 'FULL_DAY' ? 2 : 1;
  const dateKeys = snapshots.map((snapshot) => snapshot?.dateKey);
  if (new Set(dateKeys).size !== dateKeys.length) return false;
  if (!snapshots.every((snapshot) => (
    isValidDateKey(snapshot?.dateKey) && snapshot.units === expectedUnits
  ))) return false;
  if (Array.isArray(record.workingDateKeys) && !arraysEqual(record.workingDateKeys, dateKeys)) {
    return false;
  }
  if (Number.isInteger(record.requestedUnits)
    && record.requestedUnits !== snapshots.reduce((sum, snapshot) => sum + snapshot.units, 0)) {
    return false;
  }

  const expected = dateKeys.flatMap((dateKey) => (
    portions.map((portion) => `${dateKey}:${portion}`)
  ));
  return values.every((value) => (
    typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}:(MORNING|AFTERNOON)$/.test(value)
    && isValidDateKey(value.slice(0, 10))
  )) && arraysEqual(values, expected);
}

function validOvertimeCanonicalValues(record, conflictField) {
  const values = record[conflictField];
  if (!Array.isArray(values) || values.length === 0) return false;
  if (!values.every((value) => Number.isFinite(value) && Number.isInteger(value) && value >= 0)) {
    return false;
  }
  const startAt = new Date(record.plannedStartAt);
  const endAt = new Date(record.plannedEndAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return false;
  if (startAt.getTime() % 60000 !== 0 || endAt.getTime() % 60000 !== 0) return false;

  const startMinute = startAt.getTime() / 60000;
  const endMinute = endAt.getTime() / 60000;
  const durationMinutes = endMinute - startMinute;
  if (startMinute < 0 || !Number.isInteger(durationMinutes) || durationMinutes <= 0) return false;
  if (!Number.isInteger(record.requestedMinutes) || record.requestedMinutes !== durationMinutes) {
    return false;
  }
  const expected = Array.from({ length: durationMinutes }, (_, index) => startMinute + index);
  return arraysEqual(values, expected);
}

function validCanonicalValues(record, conflictField, kind) {
  return kind === 'leave'
    ? validLeaveCanonicalValues(record, conflictField)
    : validOvertimeCanonicalValues(record, conflictField);
}

async function findMalformedCanonicalKeys(Model, conflictField, kind) {
  const records = await Model.aggregate([
    { $match: { status: { $in: [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED] } } },
    {
      $project: kind === 'leave'
        ? {
          profileId: 1,
          [conflictField]: 1,
          portion: 1,
          workingDateKeys: 1,
          workingDateSnapshots: 1,
          requestedUnits: 1,
        }
        : {
          profileId: 1,
          [conflictField]: 1,
          plannedStartAt: 1,
          plannedEndAt: 1,
          requestedMinutes: 1,
        },
    },
  ]);
  return records.filter((record) => !validCanonicalValues(record, conflictField, kind));
}

function duplicateError(label, duplicates) {
  const sample = duplicates.slice(0, 10).map((duplicate) => ({
    profileId: String(duplicate._id.profileId),
    conflictKey: duplicate._id.conflictKey,
    requestIds: (duplicate.requestIds || []).map(String),
  }));
  const error = new Error(`Cannot create HR time indexes: duplicate active ${label}`);
  error.duplicates = sample;
  return error;
}

function malformedError(leaveRecords, overtimeRecords) {
  const error = new Error('Cannot create HR time indexes: active requests have malformed canonical conflict keys');
  error.malformedCanonicalKeys = {
    leave: leaveRecords.slice(0, 10).map((record) => ({
      requestId: String(record._id),
      profileId: String(record.profileId),
    })),
    overtime: overtimeRecords.slice(0, 10).map((record) => ({
      requestId: String(record._id),
      profileId: String(record.profileId),
    })),
  };
  return error;
}

function safeDatabaseTarget(connection) {
  const host = String(connection?.host || '').trim();
  const database = String(connection?.name || '').trim();
  if (!host || !database) throw new Error('Mongo target host and database are unavailable');
  const target = { host, database };
  if (Number.isInteger(connection.port)) target.port = connection.port;
  return target;
}

async function ensureHrTimeIndexes(target) {
  if (!target?.host || !target?.database) throw new Error('Mongo target host and database are required');
  logger.info('HR time index target', { target });
  const [malformedLeaveKeys, malformedOvertimeKeys] = await Promise.all([
    findMalformedCanonicalKeys(LeaveRequest, 'conflictKeys', 'leave'),
    findMalformedCanonicalKeys(OvertimeRequest, 'conflictMinuteKeys', 'overtime'),
  ]);
  if (malformedLeaveKeys.length || malformedOvertimeKeys.length) {
    throw malformedError(malformedLeaveKeys, malformedOvertimeKeys);
  }
  const [leaveDuplicates, overtimeDuplicates] = await Promise.all([
    findActiveDuplicates(LeaveRequest, 'conflictKeys'),
    findActiveDuplicates(OvertimeRequest, 'conflictMinuteKeys'),
  ]);
  if (leaveDuplicates.length) throw duplicateError('leave conflict keys', leaveDuplicates);
  if (overtimeDuplicates.length) throw duplicateError('overtime conflict minutes', overtimeDuplicates);
  const [leaveIndexes, overtimeIndexes] = await Promise.all([
    LeaveRequest.createIndexes(),
    OvertimeRequest.createIndexes(),
  ]);
  return { target, leaveIndexes, overtimeIndexes };
}

async function runEnsureHrTimeIndexes() {
  const connection = await connectDatabase();
  try {
    const result = await ensureHrTimeIndexes(safeDatabaseTarget(connection));
    logger.info('HR time indexes ensured', result);
    return result;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  runEnsureHrTimeIndexes().catch((error) => {
    logger.error('HR time index setup failed', {
      error,
      duplicates: error.duplicates || [],
      malformedCanonicalKeys: error.malformedCanonicalKeys || null,
    });
    process.exitCode = 1;
  });
}

module.exports = {
  ensureHrTimeIndexes,
  findActiveDuplicates,
  findMalformedCanonicalKeys,
  runEnsureHrTimeIndexes,
  safeDatabaseTarget,
  validCanonicalValues,
  validLeaveCanonicalValues,
  validOvertimeCanonicalValues,
};
