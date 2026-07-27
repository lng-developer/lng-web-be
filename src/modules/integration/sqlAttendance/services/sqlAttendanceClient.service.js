const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function safeIdentifier(value, name) {
  if (!IDENTIFIER.test(value)) throw new Error(`${name} is invalid`);
  return `[${value}]`;
}

function normalizeRows(rows = []) {
  return rows.flatMap((row) => {
    const sourceId = row.sourceId === undefined || row.sourceId === null ? '' : String(row.sourceId).trim();
    const employeeCode = String(row.employeeCode || (row.userId === undefined || row.userId === null ? '' : `J${row.userId}`))
      .trim().toUpperCase();
    const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt);
    return sourceId && employeeCode && !Number.isNaN(occurredAt.getTime())
      ? [{ sourceId, employeeCode, occurredAt }]
      : [];
  });
}

async function fetchPage({ afterTimestamp, afterSourceId, limit = 500 }) {
  // Lazy require keeps module import side-effect free; the worker is the only production SQL client owner.
  const sql = require('mssql');
  const schema = safeIdentifier(process.env.DB_ATTENDANCE_SCHEMA || 'dbo', 'DB_ATTENDANCE_SCHEMA');
  const table = safeIdentifier(process.env.DB_ATTENDANCE_TABLE || 'CHECKINOUT', 'DB_ATTENDANCE_TABLE');
  const timestampColumn = safeIdentifier(process.env.DB_ATTENDANCE_TIMESTAMP_COLUMN || 'CHECKTIME', 'DB_ATTENDANCE_TIMESTAMP_COLUMN');
  const tieBreakColumn = safeIdentifier(process.env.DB_ATTENDANCE_TIE_BREAK_COLUMN || 'USERID', 'DB_ATTENDANCE_TIE_BREAK_COLUMN');
  const userColumn = safeIdentifier(process.env.DB_ATTENDANCE_USER_COLUMN || 'USERID', 'DB_ATTENDANCE_USER_COLUMN');
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 500, 1), 5000);
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: Number.parseInt(process.env.DB_PORT || '1433', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const request = pool.request().input('limit', sql.Int, safeLimit);
  let cursor = '';
  if (afterTimestamp) {
    request.input('afterTimestamp', sql.DateTime2, afterTimestamp);
    request.input('afterSourceId', sql.NVarChar(255), String(afterSourceId || ''));
    cursor = `WHERE (${timestampColumn} > @afterTimestamp OR (${timestampColumn} = @afterTimestamp AND CONVERT(nvarchar(255), ${tieBreakColumn}) > @afterSourceId))`;
  }
  const result = await request.query(`
SELECT TOP (@limit)
  CONVERT(nvarchar(255), ${tieBreakColumn}) AS sourceId,
  ${userColumn} AS userId,
  ${timestampColumn} AS occurredAt
FROM ${schema}.${table}
${cursor}
ORDER BY ${timestampColumn} ASC, CONVERT(nvarchar(255), ${tieBreakColumn}) ASC
`);
  return normalizeRows(result.recordset || []);
}

module.exports = { fetchPage, normalizeRows };
