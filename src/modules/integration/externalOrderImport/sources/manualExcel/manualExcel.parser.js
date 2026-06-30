const AppError = require('../../../../../shared/errors/appError');
const errorCodes = require('../../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../../shared/constants/httpStatus');
const {
  externalOrderImportIssueTypes,
} = require('../../constants/externalOrderImportIssueTypes');

function importError(message, issueType) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, { issueType });
}

function getExtension(filename = '') {
  const parts = String(filename).toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function detectDelimiter({ originalFilename, mimeType } = {}) {
  const extension = getExtension(originalFilename);

  if (['txt', 'tsv'].includes(extension) || ['text/plain', 'text/tab-separated-values'].includes(mimeType)) {
    return '\t';
  }

  if (extension === 'csv' || mimeType === 'text/csv') {
    return ',';
  }

  throw importError('Unsupported file type', externalOrderImportIssueTypes.UNSUPPORTED_FILE_TYPE);
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function splitDelimitedRecords(content) {
  const normalized = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const records = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += char + next;
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }

    if (char === '\n' && !quoted) {
      if (current.length > 0) {
        records.push(current);
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    records.push(current);
  }

  return records;
}

function parseUploadedOrderReport(buffer, { originalFilename, mimeType } = {}) {
  const delimiter = detectDelimiter({ originalFilename, mimeType });
  const content = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  const lines = splitDelimitedRecords(content);

  if (lines.length < 2) {
    throw importError('Invalid file format', externalOrderImportIssueTypes.INVALID_FILE_FORMAT);
  }

  const headers = parseDelimitedLine(lines[0], delimiter);
  headers[0] = headers[0].replace(/^\uFEFF/, '');

  if (headers.length === 0 || headers.some((header) => !header)) {
    throw importError('Invalid file format', externalOrderImportIssueTypes.INVALID_FILE_FORMAT);
  }

  const rows = lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] === undefined ? '' : cells[index];
      return row;
    }, {});
  });

  return {
    rows,
    headers,
    rowCount: rows.length,
  };
}

module.exports = {
  parseUploadedOrderReport,
  splitDelimitedRecords,
};
