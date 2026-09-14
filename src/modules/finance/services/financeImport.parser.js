const crypto = require('crypto');
const { extractEmployeeCode } = require('../../../shared/utils/sku');

function parseDelimitedLine(line, delimiter = ',') {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function splitDelimitedRecords(text) {
  const records = [];
  let current = '';
  let quoted = false;
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '""';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (char === '\n' && !quoted) {
      if (current.trim()) records.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) records.push(current);
  return records;
}

function key(value) {
  return String(value || '').trim().toLowerCase();
}

function rowObject(headers, values) {
  return headers.reduce((row, header, index) => {
    row[key(header)] = values[index] === undefined ? '' : values[index];
    return row;
  }, {});
}

function requiredRowErrors(raw, fields, row) {
  return fields.filter((field) => !String(raw[field] || '').trim())
    .map((field) => ({ row, field, message: `${field} is required` }));
}

const transactionHeaderAliases = Object.freeze({
  date: 'date/time',
  'transaction type': 'type',
  'product details': 'description',
  'total product charges': 'product sales',
  'total promotional rebates': 'promotional rebates',
  'amazon fees': 'selling fees',
  'total (usd)': 'total',
});

function normalizeTransactionHeaders(headers) {
  return headers.map((header) => transactionHeaderAliases[key(header)] || header);
}

function moneyToMinor(value) {
  const cleaned = String(value ?? '')
    .replace(/[$,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!cleaned) return 0;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function percentToBps(value) {
  const cleaned = String(value ?? '').replace('%', '').trim();
  if (!cleaned) return 0;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function ratioToBps(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) ? Math.round(number * 10000) : 0;
}

function parseDate(value) {
  const text = String(value || '').trim();
  const isCalendarDate = /^[A-Za-z]+\s+\d{1,2},\s+\d{4}$/.test(text)
    || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text);
  const date = new Date(isCalendarDate ? `${text} UTC` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateRangeStart(value) {
  const start = String(value || '').split(' - ')[0]?.trim();
  return parseDate(start);
}

function normalizeCampaignId(value) {
  return String(value || '').trim().replace(/^="(.*)"$/, '$1');
}

function sellerEmployeeCodeFrom(value) {
  return String(value || '').match(/(?:^|[^A-Za-z0-9])(J\d{4})(?![A-Za-z0-9])/i)?.[1]?.toUpperCase() || null;
}

function toTransactionRow(raw, importKey) {
  const row = {
    importKey,
    raw,
    postedAt: parseDate(raw['date/time']),
    settlementId: raw['settlement id'] || null,
    transactionType: raw.type || null,
    transactionStatus: raw['transaction status'] || null,
    externalOrderId: raw['order id'] || null,
    sku: raw.sku || null,
    description: raw.description || null,
    quantityPurchased: raw.quantity ? Number(raw.quantity) : null,
    currency: 'USD',
    productSalesAmount: moneyToMinor(raw['product sales']),
    shippingCreditsAmount: moneyToMinor(raw['shipping credits']),
    promotionalRebatesAmount: moneyToMinor(raw['promotional rebates']),
    marketplaceWithheldTaxAmount: moneyToMinor(raw['marketplace withheld tax']),
    sellingFeesAmount: moneyToMinor(raw['selling fees']),
    fbaFeesAmount: moneyToMinor(raw['fba fees']),
    otherTransactionFeesAmount: moneyToMinor(raw['other transaction fees']),
    otherAmount: moneyToMinor(raw.other),
    totalAmount: moneyToMinor(raw.total),
  };
  row.dedupKey = crypto.createHash('sha256').update([
    row.postedAt?.toISOString() || '',
    row.settlementId || '',
    row.transactionType || '',
    row.externalOrderId || '',
    row.sku || '',
    row.description || '',
  ].map((value) => String(value).trim().toUpperCase()).join('\u001f')).digest('hex');
  return row;
}

function parseTransactionCsv(text) {
  const lines = splitDelimitedRecords(text);
  const headerIndex = lines.findIndex((line) => ['date/time', 'date'].includes(key(parseDelimitedLine(line)[0])));
  if (headerIndex < 0) {
    return { rows: [], errors: [{ row: 1, field: 'header', message: 'transaction header is required' }] };
  }
  const headers = normalizeTransactionHeaders(parseDelimitedLine(lines[headerIndex]));
  const headerErrors = requiredRowErrors(
    rowObject(headers, headers),
    ['date/time', 'type', 'total'],
    headerIndex + 1,
  );
  if (headerErrors.length) return { rows: [], errors: headerErrors };

  const rows = [];
  const errors = [];
  lines.slice(headerIndex + 1).forEach((line, index) => {
    const row = headerIndex + index + 2;
    const raw = rowObject(headers, parseDelimitedLine(line));
    const rowErrors = requiredRowErrors(raw, ['date/time', 'type', 'total'], row);
    if (rowErrors.length) errors.push(...rowErrors);
    else rows.push(toTransactionRow(raw, `transaction:${row}`));
  });

  return { rows, errors };
}

function toSettlementRow(raw, importKey) {
  const transactionType = raw['transaction-type'] || null;
  const row = {
    importKey,
    raw,
    isHeader: !transactionType && !!raw['settlement-start-date'],
    settlementId: raw['settlement-id'] || null,
    periodStartAt: parseDate(raw['settlement-start-date']),
    periodEndAt: parseDate(raw['settlement-end-date']),
    depositAt: parseDate(raw['deposit-date']),
    totalAmount: moneyToMinor(raw['total-amount']),
    currency: raw.currency || 'USD',
    transactionType,
    externalOrderId: raw['order-id'] || null,
    externalItemId: raw['order-item-code'] || null,
    sku: raw.sku || null,
    amountType: raw['amount-type'] || null,
    amountDescription: raw['amount-description'] || null,
    amount: moneyToMinor(raw.amount),
    quantityPurchased: raw['quantity-purchased'] ? Number(raw['quantity-purchased']) : null,
    postedAt: parseDate(raw['posted-date-time'] || raw['posted-date']),
  };
  if (!row.isHeader) {
    row.dedupKey = crypto.createHash('sha256').update([
      row.settlementId || '',
      row.postedAt?.toISOString() || '',
      row.transactionType || '',
      row.externalOrderId || '',
      row.externalItemId || '',
      row.sku || '',
      row.amountType || '',
      row.amountDescription || '',
    ].map((value) => String(value).trim().toUpperCase()).join('\u001f')).digest('hex');
  }
  return row;
}

function parseSettlementTxt(text) {
  const lines = splitDelimitedRecords(text);
  if (!lines.length) return { rows: [], errors: [{ row: 1, field: 'header', message: 'settlement header is required' }] };
  const headers = parseDelimitedLine(lines[0], '\t');
  const headerErrors = requiredRowErrors(rowObject(headers, headers), [
    'settlement-id', 'settlement-start-date', 'settlement-end-date',
  ], 1);
  if (headerErrors.length) return { rows: [], errors: headerErrors };

  const rows = [];
  const errors = [];
  lines.slice(1).forEach((line, index) => {
    const row = index + 2;
    const raw = rowObject(headers, parseDelimitedLine(line, '\t'));
    const isHeader = !String(raw['transaction-type'] || '').trim();
    const required = isHeader
      ? ['settlement-id', 'settlement-start-date', 'settlement-end-date']
      : ['settlement-id', 'transaction-type', 'amount'];
    const rowErrors = requiredRowErrors(raw, required, row);
    if (rowErrors.length) errors.push(...rowErrors);
    else rows.push(toSettlementRow(raw, `settlement:${row}`));
  });
  return { rows, errors };
}

function toAdsRow(raw, importKey) {
  const portfolioSellerEmployeeCode = extractEmployeeCode(raw['portfolio name']);
  const campaignSellerEmployeeCode = extractEmployeeCode(raw['campaign name']);
  const sellerEmployeeCode = campaignSellerEmployeeCode || portfolioSellerEmployeeCode;
  const sellerAttributionSource = campaignSellerEmployeeCode
    ? 'CAMPAIGN_NAME'
    : portfolioSellerEmployeeCode ? 'PORTFOLIO_NAME' : 'UNASSIGNED';

  return {
    importKey,
    raw,
    reportDate: parseDateRangeStart(raw['date range']) || parseDate(raw.date),
    advertiserAccountId: normalizeCampaignId(raw['advertiser account id']) || null,
    portfolioId: normalizeCampaignId(raw['portfolio id']) || null,
    portfolioName: raw['portfolio name'] || null,
    sellerEmployeeCode,
    sellerAttributionSource,
    programType: raw['program type'] || null,
    campaignName: raw['campaign name'] || null,
    campaignId: normalizeCampaignId(raw['campaign id']) || null,
    retailer: raw.retailer || null,
    country: raw.country || null,
    status: raw.status || null,
    currency: raw.currency || 'USD',
    budgetAmount: moneyToMinor(raw['budget amount']),
    spendAmount: moneyToMinor(raw['total cost'] || raw.spend),
    attributedSalesAmount: moneyToMinor(raw['7 day total sales']),
    impressions: Number(raw.impressions || 0),
    clicks: Number(raw.clicks || 0),
    orders7d: Number(raw['7 day total orders (#)'] || 0),
    ctrBps: percentToBps(raw['click-thru rate (ctr)']),
    acosBps: percentToBps(raw['total advertising cost of sales (acos)']),
    roasBps: ratioToBps(raw['total return on advertising spend (roas)']),
    cpcAmount: moneyToMinor(raw['cost per click (cpc)']),
  };
}

function parseAdsCsv(text) {
  const lines = splitDelimitedRecords(text);
  if (!lines.length) return { rows: [], errors: [{ row: 1, field: 'header', message: 'ads header is required' }] };
  const headers = parseDelimitedLine(lines[0]);
  const rows = lines.slice(1).map((line, index) => {
    const raw = rowObject(headers, parseDelimitedLine(line));
    return toAdsRow(raw, `ads:${index + 2}`);
  });
  return { rows, errors: [] };
}

module.exports = {
  key,
  moneyToMinor,
  parseAdsCsv,
  parseDate,
  parseDelimitedLine,
  parseSettlementTxt,
  parseTransactionCsv,
  splitDelimitedRecords,
  percentToBps,
  rowObject,
  toAdsRow,
  toSettlementRow,
  toTransactionRow,
};
