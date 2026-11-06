const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function safeIdentifier(value, name) {
  if (!IDENTIFIER.test(value)) throw new Error(`${name} is invalid`);
  return `[${value}]`;
}

function resolveEventIdExpression(userColumn, timestampColumn) {
  const value = String(process.env.DB_ATTENDANCE_EVENT_ID_COLUMN || '').trim();
  if (value) {
    return safeIdentifier(value, 'DB_ATTENDANCE_EVENT_ID_COLUMN');
  }
  const useComposite = String(process.env.DB_ATTENDANCE_USE_COMPOSITE_ID || '').trim().toLowerCase();
  if (useComposite === 'true' || useComposite === '1') {
    return `CONCAT(CONVERT(nvarchar(100), ${userColumn}), N'_', CONVERT(nvarchar(30), ${timestampColumn}, 120))`;
  }
  const error = new Error('DB_ATTENDANCE_EVENT_ID_COLUMN must name a stable unique SQL attendance event column');
  error.code = 'SQL_ATTENDANCE_EVENT_ID_REQUIRED';
  throw error;
}

function normalizeRows(rows = []) {
  return rows.flatMap((row) => {
    const sourceEventId = row.sourceEventId === undefined || row.sourceEventId === null
      ? '' : String(row.sourceEventId).trim();
    const rawUser = row.userId === undefined || row.userId === null ? '' : String(row.userId).trim();
    const employeeCode = String(
      row.employeeCode || (rawUser.toUpperCase().startsWith('J') ? rawUser : (rawUser ? `J${rawUser}` : '')),
    ).trim().toUpperCase();
    const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt);
    return sourceEventId && employeeCode && !Number.isNaN(occurredAt.getTime())
      ? [{ sourceEventId, employeeCode, occurredAt }]
      : [];
  });
}

async function fetchPage({ afterTimestamp, afterSourceEventId, limit = 500 }) {
  const schema = safeIdentifier(process.env.DB_ATTENDANCE_SCHEMA || 'dbo', 'DB_ATTENDANCE_SCHEMA');
  const table = safeIdentifier(process.env.DB_ATTENDANCE_TABLE || 'CHECKINOUT', 'DB_ATTENDANCE_TABLE');
  const timestampColumn = safeIdentifier(process.env.DB_ATTENDANCE_TIMESTAMP_COLUMN || 'CHECKTIME', 'DB_ATTENDANCE_TIMESTAMP_COLUMN');
  const userColumn = safeIdentifier(process.env.DB_ATTENDANCE_USER_COLUMN || 'USERID', 'DB_ATTENDANCE_USER_COLUMN');
  const eventIdExpr = resolveEventIdExpression(userColumn, timestampColumn);

  // Lazy require keeps module import side-effect free; the worker is the only production SQL client owner.
  const sql = require('mssql');
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
    request.input('afterSourceEventId', sql.NVarChar(255), String(afterSourceEventId || ''));
    cursor = `WHERE (${timestampColumn} > @afterTimestamp OR (${timestampColumn} = @afterTimestamp AND CONVERT(nvarchar(255), ${eventIdExpr}) > @afterSourceEventId))`;
  }
  const result = await request.query(`
SELECT TOP (@limit)
  CONVERT(nvarchar(255), ${eventIdExpr}) AS sourceEventId,
  ${userColumn} AS userId,
  ${timestampColumn} AS occurredAt
FROM ${schema}.${table}
${cursor}
ORDER BY ${timestampColumn} ASC, CONVERT(nvarchar(255), ${eventIdExpr}) ASC
`);
  return normalizeRows(result.recordset || []);
}

module.exports = { fetchPage, normalizeRows, resolveEventIdExpression };
