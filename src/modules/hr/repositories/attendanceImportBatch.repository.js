const AttendanceImportBatch = require('../models/attendanceImportBatch.model');

async function findBySourceBatchId(sourceBatchId) {
  return AttendanceImportBatch.findOne({ sourceBatchId }).lean();
}

async function claim(sourceBatchId, punchCount) {
  const result = { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  const retried = await AttendanceImportBatch.findOneAndUpdate(
    { sourceBatchId, status: 'FAILED' },
    { $set: { status: 'PROCESSING', punchCount, result } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (retried) return { acquired: true, batch: retried };
  try {
    const created = await AttendanceImportBatch.create({ sourceBatchId, status: 'PROCESSING', punchCount, result });
    return { acquired: true, batch: created.toObject() };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return { acquired: false, batch: await findBySourceBatchId(sourceBatchId) };
  }
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
  claim,
  fail: (sourceBatchId, result) => setResult(sourceBatchId, 'FAILED', result),
  findBySourceBatchId,
};
