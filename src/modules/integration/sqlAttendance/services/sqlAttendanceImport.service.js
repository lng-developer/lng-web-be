const crypto = require('crypto');
const hrPublic = require('../../../hr/public');
const client = require('./sqlAttendanceClient.service');
const repository = require('../repositories/sqlAttendanceSync.repository');

function batchId(rows) {
  const signature = rows.map((row) => `${row.occurredAt.toISOString()}:${row.sourceEventId}`).join('|');
  return `sql-attendance:${crypto.createHash('sha256').update(signature).digest('hex')}`;
}

async function syncPage({ limit = 500 } = {}, dependencies = {}) {
  const source = dependencies.client || client;
  const states = dependencies.repository || repository;
  const hr = dependencies.hrPort || hrPublic;
  const state = await states.getState();
  await states.markRunning();
  try {
    const rows = await source.fetchPage({
      afterTimestamp: state.lastSourceTimestamp,
      afterSourceEventId: state.lastSourceEventId,
      limit,
    });
    if (!rows.length) {
      const result = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
      await states.advance({
        lastSourceTimestamp: state.lastSourceTimestamp,
        lastSourceEventId: state.lastSourceEventId,
        sourceBatchId: null,
        result,
      });
      return result;
    }
    const sourceBatchId = batchId(rows);
    const punches = rows.map(({ sourceEventId, ...row }) => ({ ...row, sourceId: sourceEventId }));
    const imported = await hr.importAttendancePunches({ sourceBatchId, punches });
    const result = { fetched: rows.length, ...imported };
    if (result.failed) {
      const error = new Error(`SQL attendance page has ${result.failed} failed punches`);
      error.code = 'SQL_ATTENDANCE_PAGE_FAILED';
      throw error;
    }
    const last = rows[rows.length - 1];
    await states.advance({
      lastSourceTimestamp: last.occurredAt,
      lastSourceEventId: String(last.sourceEventId),
      sourceBatchId,
      result,
    });
    return result;
  } catch (error) {
    await states.markFailed({ errorMessage: error.message });
    throw error;
  }
}

module.exports = { syncPage };
