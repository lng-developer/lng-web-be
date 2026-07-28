const AttendanceImportBatch = require('../models/attendanceImportBatch.model');

async function findBySourceBatchId(sourceBatchId) {
  return AttendanceImportBatch.findOne({ sourceBatchId }).lean();
}

async function start(sourceBatchId, punchCount) {
  return AttendanceImportBatch.findOneAndUpdate(
    { sourceBatchId },
    { $set: { status: 'PROCESSING', punchCount } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

async function setResult(sourceBatchId, status, result) {
  return AttendanceImportBatch.findOneAndUpdate(
    { sourceBatchId },
    { $set: { status, result } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  complete: (sourceBatchId, result) => setResult(sourceBatchId, 'COMPLETED', result),
  fail: (sourceBatchId, result) => setResult(sourceBatchId, 'FAILED', result),
  findBySourceBatchId,
  start,
};
