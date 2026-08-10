const fs = require('fs');
const path = require('path');

function parseArgs(argv = process.argv.slice(2), defaults = {}) {
  return argv.reduce((args, arg) => {
    const [key, ...valueParts] = String(arg).replace(/^--/, '').split('=');
    if (!key) return args;
    return { ...args, [key]: valueParts.length ? valueParts.join('=') : true };
  }, defaults);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.length);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
  });
}

function toCode(value, fallback = 'UNKNOWN') {
  const code = String(value || '')
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return code || fallback;
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function upper(value) {
  const text = clean(value);
  return text ? text.toUpperCase() : null;
}

function toBool(value) {
  return ['true', '1', 'yes', 'active'].includes(String(value || '').trim().toLowerCase());
}

function toInt(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) ? number : fallback;
}

function toMinorUnit(value) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100);
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  clean,
  ensureDir,
  parseArgs,
  readCsv,
  readJson,
  toBool,
  toCode,
  toInt,
  toMinorUnit,
  uniqueBy,
  upper,
  writeJson,
};
